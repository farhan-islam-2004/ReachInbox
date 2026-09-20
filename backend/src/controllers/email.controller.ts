import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { emailSchedulerService } from '../services/email-scheduler.service';

const attachmentItemSchema = z.object({
  filename: z.string(),
  size: z.union([z.number(), z.string()]).optional(),
  contentType: z.string().optional(),
  data: z.string().optional(),
  previewUrl: z.string().optional(),
  url: z.string().optional(),
});

const scheduleEmailSchema = z.object({
  recipient: z.string().trim().email('Invalid recipient email address format'),
  subject: z.string().trim().min(1, 'Subject must not be empty'),
  body: z.string().trim().min(1, 'Body must not be empty'),
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO-8601 timestamp' })
    .refine((val) => new Date(val).getTime() > Date.now(), {
      message: 'scheduledAt must be a valid future timestamp',
    }),
  campaignId: z.string().uuid().optional(),
  senderId: z.string().uuid().optional(),
  attachments: z.array(attachmentItemSchema).optional(),
});

export const scheduleEmailController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parseResult = scheduleEmailSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
      return;
    }

    const scheduledEmail = await emailSchedulerService.scheduleEmail(
      parseResult.data,
      req.user?.id
    );

    res.status(201).json({
      success: true,
      data: scheduledEmail,
    });
  } catch (error) {
    next(error);
  }
};

const scheduleBatchSchema = z.object({
  emails: z
    .array(
      z.object({
        recipient: z.string().trim().email('Invalid recipient email address format'),
        subject: z.string().trim().min(1, 'Subject must not be empty'),
        body: z.string().trim().min(1, 'Body must not be empty'),
        scheduledAt: z
          .string()
          .datetime({ message: 'scheduledAt must be a valid ISO-8601 timestamp' }),
        senderId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        attachments: z.array(attachmentItemSchema).optional(),
      })
    )
    .min(1, 'Batch must contain at least 1 email')
    .max(1000, 'Batch cannot exceed 1000 emails per request'),
});

export const scheduleBatchController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parseResult = scheduleBatchSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
      return;
    }

    const result = await emailSchedulerService.scheduleBatch(
      parseResult.data.emails,
      req.user?.id
    );

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const getEmailByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const emailId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication required' },
      });
      return;
    }

    const email = await emailSchedulerService.getEmailById(emailId, req.user.id);
    if (!email) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Email not found or access denied',
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: email,
    });
  } catch (error) {
    next(error);
  }
};

export const listEmailsController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication required' },
      });
      return;
    }

    const { status, page, limit } = req.query;
    const result = await emailSchedulerService.listEmails(req.user.id, {
      status: typeof status === 'string' ? status : undefined,
      page: typeof page === 'string' ? parseInt(page, 10) : 1,
      limit: typeof limit === 'string' ? parseInt(limit, 10) : 50,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const listSendersController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication required' },
      });
      return;
    }

    const senders = await emailSchedulerService.listSenders(req.user.id);
    res.status(200).json({
      success: true,
      data: senders,
    });
  } catch (error) {
    next(error);
  }
};
