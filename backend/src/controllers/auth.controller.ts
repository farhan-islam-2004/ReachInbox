import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { SESSION_COOKIE_NAME } from '../middleware/auth.middleware';
import { env } from '../config/env';

export const googleLoginController = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const state = await authService.generateOAuthState();
    const authUrl = authService.getGoogleAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
};

export const googleCallbackController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      res.status(400).json({
        success: false,
        error: {
          message: `Google authorization denied: ${error}`,
        },
      });
      return;
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          message: 'Missing required code or state query parameter',
        },
      });
      return;
    }

    // 1. Validate state parameter (CSRF protection, single-use)
    const isValidState = await authService.validateOAuthState(state);
    if (!isValidState) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid, missing, or expired OAuth state parameter',
        },
      });
      return;
    }

    // 2. Exchange authorization code with Google and verify OpenID Connect identity
    const identity = await authService.exchangeGoogleCode(code);

    // 3. Resolve or create user mapped to Google subject ID (sub)
    const user = await authService.resolveOrCreateGoogleUser(identity);

    // 4. Create new persistent server-side session in PostgreSQL
    const session = await authService.createSession(user.id);

    // 5. Attach HTTP-only session cookie (sameSite: 'none' for cross-site Railway frontend/backend)
    res.cookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    console.log(`[Auth] User authenticated via Google: ${user.email} (${user.id})`);

    // 6. Redirect to frontend dashboard
    res.redirect(env.FRONTEND_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google OAuth exchange failed';
    console.error(`[Auth] Google OAuth callback failed: ${message}`);

    const wantsJson = req.headers.accept?.includes('application/json');
    if (wantsJson) {
      res.status(400).json({
        success: false,
        error: { message },
      });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(message)}`);
  }
};

export const meController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user!;
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        googleId: user.googleId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const logoutController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.sessionId) {
      await authService.destroySession(req.sessionId);
    }

    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const authStatusController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionId) {
      res.status(200).json({
        success: true,
        authenticated: false,
        user: null,
      });
      return;
    }

    const user = await authService.validateSession(sessionId);
    if (!user) {
      res.status(200).json({
        success: true,
        authenticated: false,
        user: null,
      });
      return;
    }

    res.status(200).json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        googleId: user.googleId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};
