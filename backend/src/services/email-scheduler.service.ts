import { randomUUID } from 'crypto';
import { PrismaClient, Email } from '@prisma/client';
import { addEmailJob, addEmailJobs } from '../queues/email.queue';
import { env } from '../config/env';

const prisma = new PrismaClient();

export interface ScheduleEmailInput {
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  campaignId?: string;
  senderId?: string;
  attachments?: any;
}

export interface ScheduledEmailResponse {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  status: string;
  delayMs: number;
  jobId: string;
  attachments?: any;
}

export interface ScheduleBatchResponse {
  success: boolean;
  scheduled: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
}

/**
 * Ensures minimum required development records exist to satisfy PostgreSQL foreign keys
 * without introducing mock or fake authentication mechanisms for tests.
 */
export const getOrCreateDefaultDevContext = async () => {
  const devUser = await prisma.user.upsert({
    where: { email: 'dev@reachinbox.ai' },
    update: {},
    create: {
      email: 'dev@reachinbox.ai',
      name: 'ReachInbox Developer',
    },
  });

  let sender = await prisma.sender.findFirst({
    where: { userId: devUser.id },
  });

  const etherealUser = env.ETHEREAL_USER || 'dev_ethereal_user';
  const etherealPassword = env.ETHEREAL_PASSWORD || 'dev_ethereal_password';
  const senderEmail = env.ETHEREAL_USER || 'dev-sender@reachinbox.ai';

  if (!sender) {
    sender = await prisma.sender.create({
      data: {
        userId: devUser.id,
        email: senderEmail,
        etherealUser,
        etherealPassword,
      },
    });
  } else if (sender.etherealUser !== etherealUser || sender.etherealPassword !== etherealPassword) {
    sender = await prisma.sender.update({
      where: { id: sender.id },
      data: {
        email: senderEmail,
        etherealUser,
        etherealPassword,
      },
    });
  }

  let campaign = await prisma.campaign.findFirst({
    where: { userId: devUser.id },
  });

  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        userId: devUser.id,
        subject: 'Default Developer Campaign',
        body: 'Default campaign body template',
        startTime: new Date(),
      },
    });
  }

  return { sender, campaign };
};

/**
 * Resolves the authenticated user's sender and campaign, strictly validating ownership.
 */
export const resolveUserContext = async (
  userId?: string,
  requestedSenderId?: string,
  requestedCampaignId?: string
) => {
  if (!userId) {
    return await getOrCreateDefaultDevContext();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('Authenticated user record not found');
  }

  // 1. Verify or resolve Sender strictly scoped to authenticated user
  let sender;
  if (requestedSenderId) {
    sender = await prisma.sender.findFirst({
      where: { id: requestedSenderId, userId },
    });
    if (!sender) {
      throw new Error('Sender not found or does not belong to authenticated user');
    }
  } else {
    sender = await prisma.sender.findFirst({
      where: { userId },
    });
    if (!sender) {
      const etherealUser = env.ETHEREAL_USER || user.email;
      const etherealPassword = env.ETHEREAL_PASSWORD || 'dev_ethereal_password';
      sender = await prisma.sender.create({
        data: {
          userId,
          email: user.email,
          etherealUser,
          etherealPassword,
        },
      });
    }
  }

  // 2. Verify or resolve Campaign strictly scoped to authenticated user
  let campaign;
  if (requestedCampaignId) {
    campaign = await prisma.campaign.findFirst({
      where: { id: requestedCampaignId, userId },
    });
    if (!campaign) {
      throw new Error('Campaign not found or does not belong to authenticated user');
    }
  } else {
    campaign = await prisma.campaign.findFirst({
      where: { userId },
    });
    if (!campaign) {
      campaign = await prisma.campaign.create({
        data: {
          userId,
          subject: `${user.name}'s Default Campaign`,
          body: 'Default campaign body template',
          startTime: new Date(),
        },
      });
    }
  }

  return { sender, campaign };
};

export class EmailSchedulerService {
  /**
   * Schedules an email by persisting the record in PostgreSQL and adding a BullMQ delayed job.
   * Scopes campaign and sender ownership to the authenticated user.
   */
  public async scheduleEmail(input: ScheduleEmailInput, userId?: string): Promise<ScheduledEmailResponse> {
    const scheduledDate = new Date(input.scheduledAt);
    const now = Date.now();
    const delayMs = scheduledDate.getTime() - now;

    if (isNaN(scheduledDate.getTime())) {
      throw new Error('Invalid scheduledAt timestamp format');
    }

    if (delayMs <= 0) {
      throw new Error('scheduledAt must be a valid future timestamp');
    }

    // Enforce ownership: Resolve or validate sender and campaign for authenticated user
    const { sender, campaign } = await resolveUserContext(userId, input.senderId, input.campaignId);

    // 1. Create and persist the authoritative Email record with status SCHEDULED
    const email: Email = await prisma.email.create({
      data: {
        campaignId: campaign.id,
        senderId: sender.id,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        attachments: input.attachments ? JSON.parse(JSON.stringify(input.attachments)) : undefined,
        scheduledAt: scheduledDate,
        status: 'SCHEDULED',
      },
    });

    // 2. Add BullMQ delayed job using deterministic ID (email_<emailId>)
    const job = await addEmailJob(email.id, delayMs);

    console.log(
      `[SchedulerService] Scheduled email ${email.id} for recipient ${email.recipient} at ${scheduledDate.toISOString()} (delay: ${delayMs}ms, jobId: ${job.id}, user: ${userId || 'dev'})`
    );

    return {
      id: email.id,
      recipient: email.recipient,
      subject: email.subject,
      scheduledAt: email.scheduledAt.toISOString(),
      status: email.status,
      delayMs,
      jobId: job.id as string,
      attachments: email.attachments,
    };
  }

  /**
   * Schedules a batch of up to 1,000+ emails using chunked PostgreSQL inserts and BullMQ addBulk.
   * Scopes campaign and sender ownership to the authenticated user.
   */
  public async scheduleBatch(inputs: ScheduleEmailInput[], userId?: string): Promise<ScheduleBatchResponse> {
    if (!inputs || inputs.length === 0) {
      throw new Error('Emails batch array must not be empty');
    }

    const { sender, campaign } = await resolveUserContext(userId);
    const now = Date.now();

    const prepared = inputs.map((input) => {
      const scheduledDate = new Date(input.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        throw new Error(`Invalid scheduledAt timestamp format for recipient ${input.recipient}`);
      }
      const delayMs = Math.max(0, scheduledDate.getTime() - now);
      const id = randomUUID();
      return {
        id,
        data: {
          id,
          campaignId: campaign.id,
          senderId: sender.id,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
          attachments: input.attachments ? JSON.parse(JSON.stringify(input.attachments)) : undefined,
          scheduledAt: scheduledDate,
          status: 'SCHEDULED' as const,
        },
        delayMs,
        scheduledDate,
      };
    });

    // 1. Chunked PostgreSQL insert (chunks of 250) for fast database writes
    const chunkSize = 250;
    for (let i = 0; i < prepared.length; i += chunkSize) {
      const chunk = prepared.slice(i, i + chunkSize);
      await prisma.email.createMany({
        data: chunk.map((p) => p.data),
      });
    }

    // 2. Batch job creation via emailQueue.addBulk (NEVER single add in a loop)
    await addEmailJobs(prepared.map((p) => ({ emailId: p.id, delayMs: p.delayMs })));

    const sortedTimestamps = prepared.map((p) => p.scheduledDate.getTime()).sort((a, b) => a - b);
    const firstScheduledAt = new Date(sortedTimestamps[0]).toISOString();
    const lastScheduledAt = new Date(sortedTimestamps[sortedTimestamps.length - 1]).toISOString();

    console.log(
      `[SchedulerService] Successfully scheduled batch of ${prepared.length} emails from ${firstScheduledAt} to ${lastScheduledAt} (user: ${userId || 'dev'})`
    );

    return {
      success: true,
      scheduled: prepared.length,
      firstScheduledAt,
      lastScheduledAt,
    };
  }

  /**
   * Fetches an email by ID strictly ensuring it belongs to the authenticated user through campaign.userId.
   */
  public async getEmailById(emailId: string, userId: string): Promise<Email | null> {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        campaign: true,
        sender: true,
      },
    });

    if (!email || email.campaign.userId !== userId) {
      return null;
    }

    return email;
  }

  /**
   * Lists emails owned by the authenticated user with optional status filtering and counts.
   */
  public async listEmails(
    userId: string,
    options?: { status?: string; page?: number; limit?: number }
  ) {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 50));
    const skip = (page - 1) * limit;

    const whereClause: any = {
      campaign: { userId },
    };
    if (options?.status) {
      whereClause.status = options.status as any;
    }

    const [emails, total, scheduledCount, sentCount] = await Promise.all([
      prisma.email.findMany({
        where: whereClause,
        include: {
          campaign: true,
          sender: true,
        },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.email.count({ where: whereClause }),
      prisma.email.count({ where: { campaign: { userId }, status: 'SCHEDULED' } }),
      prisma.email.count({ where: { campaign: { userId }, status: 'SENT' } }),
    ]);

    return {
      success: true,
      data: emails,
      counts: {
        scheduled: scheduledCount,
        sent: sentCount,
      },
      page,
      limit,
      total,
    };
  }

  /**
   * Retrieves senders owned by the authenticated user.
   */
  public async listSenders(userId: string) {
    let senders = await prisma.sender.findMany({
      where: { userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
      },
    });

    if (senders.length === 0) {
      // Auto-provision initial sender for user if none exists
      const { sender } = await resolveUserContext(userId);
      senders = [
        {
          id: sender.id,
          email: sender.email,
          createdAt: sender.createdAt,
        },
      ];
    }

    return senders;
  }
}

export const emailSchedulerService = new EmailSchedulerService();
