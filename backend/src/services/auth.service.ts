import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaClient, User, Session } from '@prisma/client';
import { getRedisClient } from '../config/redis';
import { env } from '../config/env';

const prisma = new PrismaClient();

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string | null;
}

// Test hook for mocking Google identity exchange at test boundary without network calls
export let __testGoogleExchangeHook: ((code: string) => Promise<GoogleIdentity>) | null = null;
export const setTestGoogleExchangeHook = (
  hook: ((code: string) => Promise<GoogleIdentity>) | null
): void => {
  __testGoogleExchangeHook = hook;
};

export class AuthService {
  private getOAuthClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || env.GOOGLE_REDIRECT_URI,
    });
  }

  /**
   * Generates a cryptographically secure random state parameter for OAuth 2.0 (CSRF protection)
   * and stores it in Redis with a 10-minute expiration.
   */
  public async generateOAuthState(): Promise<string> {
    const redis = getRedisClient();
    const state = crypto.randomBytes(32).toString('hex');
    await redis.set(`oauth:google:state:${state}`, '1', 'EX', 600);
    return state;
  }

  /**
   * Validates the OAuth state from the callback against Redis.
   * Single-use: The state key is deleted immediately upon validation.
   */
  public async validateOAuthState(state: string): Promise<boolean> {
    const redis = getRedisClient();
    const stateKey = `oauth:google:state:${state}`;
    const exists = await redis.get(stateKey);
    if (!exists) {
      return false;
    }
    // Single-use: Delete immediately so it cannot be replayed
    await redis.del(stateKey);
    return true;
  }

  /**
   * Builds the official Google OAuth 2.0 consent URL requesting basic OpenID Connect scopes.
   */
  public getGoogleAuthUrl(state: string): string {
    const client = this.getOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    });
  }

  /**
   * Exchanges authorization code with Google for tokens and verifies the ID token cryptographically.
   */
  public async exchangeGoogleCode(code: string): Promise<GoogleIdentity> {
    if (__testGoogleExchangeHook) {
      return await __testGoogleExchangeHook(code);
    }

    const client = this.getOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new Error('Google authorization response did not contain an ID token');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Google ID token verification failed: missing subject (sub) or email');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null,
    };
  }

  /**
   * Resolves or creates a User based on the verified Google OpenID Connect identity.
   * Google `sub` (subject identifier) is the immutable primary identity key.
   */
  public async resolveOrCreateGoogleUser(identity: GoogleIdentity): Promise<User> {
    // 1. Look up user by stable Google subject identifier (googleId)
    const existingByGoogleId = await prisma.user.findUnique({
      where: { googleId: identity.sub },
    });

    if (existingByGoogleId) {
      // Update safe profile fields without modifying googleId or stable identifiers
      return await prisma.user.update({
        where: { id: existingByGoogleId.id },
        data: {
          name: identity.name,
          avatar: identity.picture || existingByGoogleId.avatar,
          email: identity.email,
        },
      });
    }

    // 2. Check if a user exists with matching email (e.g., pre-created dev user or invited user)
    const existingByEmail = await prisma.user.findUnique({
      where: { email: identity.email },
    });

    if (existingByEmail) {
      // Link Google identity to existing user
      return await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: identity.sub,
          name: identity.name || existingByEmail.name,
          avatar: identity.picture || existingByEmail.avatar,
        },
      });
    }

    // 3. Create new User with Google identity
    return await prisma.user.create({
      data: {
        googleId: identity.sub,
        email: identity.email,
        name: identity.name,
        avatar: identity.picture || null,
      },
    });
  }

  /**
   * Creates a new cryptographically secure session record in PostgreSQL.
   * Default expiration: 7 days.
   */
  public async createSession(userId: string): Promise<Session> {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    return await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        expiresAt,
      },
    });
  }

  /**
   * Validates a session ID and returns the associated User if valid and unexpired.
   * Lazily deletes expired sessions upon access.
   */
  public async validateSession(sessionId: string): Promise<User | null> {
    if (!sessionId || typeof sessionId !== 'string') {
      return null;
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      return null;
    }

    // Check expiration
    if (session.expiresAt.getTime() < Date.now()) {
      // Lazily invalidate expired session
      await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
      return null;
    }

    return session.user;
  }

  /**
   * Destroys a session record from PostgreSQL (logout).
   */
  public async destroySession(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    try {
      await prisma.session.delete({ where: { id: sessionId } });
      return true;
    } catch {
      return false;
    }
  }
}

export const authService = new AuthService();
