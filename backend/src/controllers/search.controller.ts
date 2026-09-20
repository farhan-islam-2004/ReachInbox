import { Request, Response, NextFunction } from 'express';
import { elasticsearchService } from '../services/elasticsearch.service';

export const searchEmailsController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const q = req.query.q as string | undefined;
    const status = req.query.status as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const userId = req.user?.id;

    const result = await elasticsearchService.searchEmails({
      q,
      status,
      page,
      limit,
      userId,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(503).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Search service unavailable',
      },
    });
  }
};
