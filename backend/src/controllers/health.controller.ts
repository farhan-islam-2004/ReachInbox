import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getHealth = (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    service: 'reachinbox-backend',
    status: 'ok',
  });
};

export const getDbHealth = async (_req: Request, res: Response): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      database: 'connected',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown database error';
    console.error('Database health check failed:', errorMessage);

    res.status(503).json({
      success: false,
      database: 'disconnected',
      error: {
        message: 'Database connection failed',
      },
    });
  }
};
