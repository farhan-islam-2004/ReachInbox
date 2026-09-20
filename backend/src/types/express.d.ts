import 'express';
import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: User;
      sessionId?: string;
    }
  }
}
