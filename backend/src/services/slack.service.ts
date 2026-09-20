import crypto from 'crypto';
import { WebClient } from '@slack/web-api';
import { PrismaClient } from '@prisma/client';
import { getRedisClient } from '../config/redis';
import { env } from '../config/env';
import { RateLimitHitEvent, rateLimitService } from './rate-limit.service';

const prisma = new PrismaClient();

export interface SlackOAuthTokenResponse {
  ok: boolean;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: {
    name?: string;
    id?: string;
  };
  incoming_webhook?: {
    channel?: string;
    channel_id?: string;
    configuration_url?: string;
    url?: string;
  };
  error?: string;
}

export class SlackService {
  /**
   * Generates a cryptographically random OAuth state bound to a user and stores in Redis for 10 minutes.
   */
  public async generateOAuthState(userId: string): Promise<string> {
    const redis = getRedisClient();
    const state = crypto.randomBytes(24).toString('hex');
    await redis.set(`slack:oauth_state:${state}`, userId, 'EX', 600);
    return state;
  }

  /**
   * Validates state and exchanges authorization code for Slack access token.
   */
  public async handleOAuthCallback(code: string, state: string) {
    const redis = getRedisClient();
    const stateKey = `slack:oauth_state:${state}`;
    const userId = await redis.get(stateKey);

    if (!userId) {
      throw new Error('Invalid or expired OAuth state parameter');
    }
    await redis.del(stateKey);

    const client = new WebClient();
    const response = (await client.oauth.v2.access({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    })) as SlackOAuthTokenResponse;

    if (!response.ok || !response.access_token || !response.team?.id) {
      throw new Error(`Slack OAuth token exchange failed: ${response.error || 'Unknown error'}`);
    }

    const teamId = response.team.id;
    const teamName = response.team.name || null;
    const channelId = response.incoming_webhook?.channel_id || null;
    const channelName = response.incoming_webhook?.channel || null;

    // Persist or update SlackConnection in PostgreSQL
    const existing = await prisma.slackConnection.findFirst({
      where: { userId, teamId },
    });

    let connection;
    if (existing) {
      connection = await prisma.slackConnection.update({
        where: { id: existing.id },
        data: {
          accessToken: response.access_token,
          teamName,
          channelId,
          channelName,
        },
      });
    } else {
      connection = await prisma.slackConnection.create({
        data: {
          userId,
          teamId,
          teamName,
          channelId,
          channelName,
          accessToken: response.access_token,
        },
      });
    }

    console.log(`[Slack] Connected workspace: ${teamName} (${teamId}) for user: ${userId}`);
    return connection;
  }

  /**
   * Retrieves connection status for a user.
   */
  public async getConnectionStatus(userId: string) {
    const connection = await prisma.slackConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      return { connected: false, teamName: null, teamId: null };
    }

    return {
      connected: true,
      teamName: connection.teamName,
      teamId: connection.teamId,
      channelName: connection.channelName,
    };
  }

  /**
   * Disconnects and revokes a user's Slack connection.
   */
  public async disconnect(userId: string): Promise<boolean> {
    const connection = await prisma.slackConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      return false;
    }

    try {
      const client = new WebClient(connection.accessToken);
      await client.auth.revoke();
    } catch (error) {
      console.warn('[Slack] Token revocation warning:', error instanceof Error ? error.message : error);
    }

    await prisma.slackConnection.delete({
      where: { id: connection.id },
    });

    console.log(`[Slack] Disconnected Slack connection for user: ${userId}`);
    return true;
  }

  /**
   * Dispatches deduplicated Slack rate-limit hit notifications.
   * Ensures at most 1 notification per sender per hourly window across all worker instances.
   */
  public async notifyRateLimitHit(event: RateLimitHitEvent): Promise<boolean> {
    const redis = getRedisClient();
    const { utcHour } = rateLimitService.getUtcHourWindow();
    const dedupeKey = `slack:rate_limit_notified:${event.senderId}:${utcHour}`;

    // Atomic SET NX: only 1 worker wins and sends the Slack notification for this sender this hour
    const acquired = await redis.set(dedupeKey, '1', 'EX', 3600, 'NX');
    if (!acquired) {
      console.log(`[Slack] Rate limit notification throttled/deduplicated for sender ${event.senderId} (${utcHour})`);
      return false;
    }

    try {
      // Resolve Email -> Campaign -> User -> SlackConnection
      const email = await prisma.email.findUnique({
        where: { id: event.emailId },
        include: {
          campaign: {
            include: {
              user: {
                include: { slackConnections: true },
              },
            },
          },
        },
      });

      const connections = email?.campaign?.user?.slackConnections;
      if (!connections || connections.length === 0) {
        console.log(`[Slack] No Slack connection found for email ${event.emailId} owner. Skipping notification.`);
        return false;
      }

      const connection = connections[0];
      const client = new WebClient(connection.accessToken);
      const targetChannel = connection.channelId || 'general';

      const messageText = [
        `🚨 *ReachInbox Rate Limit Hit*`,
        `• *Sender:* ${event.senderEmail || event.senderId}`,
        `• *Scope:* ${event.scope}`,
        `• *Limit:* ${event.limit} emails/hour`,
        `• *Current Usage:* ${event.currentCount}/${event.limit}`,
        `• *Next Available:* ${event.nextAvailableAt}`,
        `• *Queued Email:* ${event.recipient || 'N/A'}`,
        `• *Email ID:* \`${event.emailId}\``,
      ].join('\n');

      await client.chat.postMessage({
        channel: targetChannel,
        text: messageText,
      });

      console.log(`[Slack] Sent rate-limit alert to workspace ${connection.teamName || connection.teamId} on channel ${targetChannel}`);
      return true;
    } catch (error) {
      console.error('[Slack] Failed to deliver Slack alert:', error instanceof Error ? error.message : error);
      return false;
    }
  }
}

export const slackService = new SlackService();
