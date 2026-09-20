import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { slackService } from '../services/slack.service';
import { env } from '../config/env';

const prisma = new PrismaClient();

// Isolated dev user resolver for test suites
export const getDevUserId = async (): Promise<string> => {
  const devUser = await prisma.user.upsert({
    where: { email: 'dev@reachinbox.ai' },
    update: {},
    create: {
      email: 'dev@reachinbox.ai',
      name: 'ReachInbox Developer',
    },
  });
  return devUser.id;
};

export const connectSlackController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user ? req.user.id : await getDevUserId();
    const state = await slackService.generateOAuthState(userId);

    const redirectUri = encodeURIComponent(env.SLACK_REDIRECT_URI);
    const scope = encodeURIComponent('chat:write,incoming-webhook');
    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scope}&redirect_uri=${redirectUri}&state=${state}`;

    res.redirect(authUrl);
  } catch (error) {
    next(error);
  }
};

export const slackCallbackController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      const message = `Slack authorization denied: ${error}`;
      console.error('[Slack Callback Error]:', message);
      const wantsJson = req.headers.accept?.includes('application/json');
      if (wantsJson) {
        res.status(400).json({
          success: false,
          error: { message },
        });
        return;
      }
      const frontendUrl = process.env.FRONTEND_URL || env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}?slack_error=${encodeURIComponent(message)}`);
      return;
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).json({
        success: false,
        error: { message: 'Missing required code or state parameter' },
      });
      return;
    }

    const connection = await slackService.handleOAuthCallback(code, state);

    const wantsJson = req.headers.accept?.includes('application/json');
    if (wantsJson) {
      res.status(200).json({
        success: true,
        message: 'Slack workspace connected successfully',
        data: {
          teamId: connection.teamId,
          teamName: connection.teamName,
          channelName: connection.channelName,
        },
      });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?slack_connected=true`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth callback failed';
    console.error('[Slack Callback Error]:', message);
    const wantsJson = req.headers.accept?.includes('application/json');
    if (wantsJson) {
      res.status(400).json({
        success: false,
        error: { message },
      });
      return;
    }
    const frontendUrl = process.env.FRONTEND_URL || env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?slack_error=${encodeURIComponent(message)}`);
  }
};

export const slackStatusController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user ? req.user.id : await getDevUserId();
    const status = await slackService.getConnectionStatus(userId);
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

export const disconnectSlackController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user ? req.user.id : await getDevUserId();
    const disconnected = await slackService.disconnect(userId);
    res.status(200).json({
      success: true,
      data: { disconnected },
    });
  } catch (error) {
    next(error);
  }
};
