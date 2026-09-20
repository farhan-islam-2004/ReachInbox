import { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export interface AppError extends Error {
  statusCode?: number;
}

export const errorHandler: ErrorRequestHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('[Error Middleware]', err);
  const statusCode = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  const isProduction = env.NODE_ENV === 'production';

  // In production, mask internal server error details to prevent info leaks
  const message = isProduction && statusCode === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(!isProduction && err.stack ? { stack: err.stack } : {}),
    },
  });
};
