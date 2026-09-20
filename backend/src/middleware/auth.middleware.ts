import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';

export const SESSION_COOKIE_NAME = 'reachinbox_session';

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. Extract session identifier from HTTP-only cookie or Authorization header fallback
    let sessionId = req.cookies?.[SESSION_COOKIE_NAME];

    if (!sessionId && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        sessionId = parts[1];
      }
    }

    if (!sessionId) {
      res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required. No active session.',
        },
      });
      return;
    }

    // 2. Validate session against PostgreSQL
    const user = await authService.validateSession(sessionId);

    if (!user) {
      // Clear invalid cookie if present
      res.clearCookie(SESSION_COOKIE_NAME);
      res.status(401).json({
        success: false,
        error: {
          message: 'Session expired or invalid. Please log in again.',
        },
      });
      return;
    }

    // 3. Attach authenticated user and session ID to Express request
    req.user = user;
    req.sessionId = sessionId;

    next();
  } catch (error) {
    next(error);
  }
};
