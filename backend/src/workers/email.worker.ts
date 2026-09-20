import { Worker, Job, DelayedError } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { redisConnectionOptions } from '../config/redis';
import { env } from '../config/env';
import { EMAIL_QUEUE_NAME, EmailJobData } from '../queues/email.queue';
import { emailSenderService, sanitizeSmtpError } from '../services/email-sender.service';
import { rateLimitService } from '../services/rate-limit.service';
import { elasticsearchService } from '../services/elasticsearch.service';
import { slackService } from '../services/slack.service';

const prisma = new PrismaClient();

// Optional test hook for controlled failure injection during database finalization
export let __testDbFinalizeHook: ((emailId: string) => Promise<void>) | null = null;
export const setTestDbFinalizeHook = (hook: ((emailId: string) => Promise<void>) | null): void => {
  __testDbFinalizeHook = hook;
};

export const processEmailJob = async (job: Job<EmailJobData>, token?: string): Promise<void> => {
  const { emailId } = job.data;
  console.log(`[Worker] Job received: ${job.id} for email: ${emailId}`);

  // 1. Load authoritative Email record from PostgreSQL, including associated Sender & Campaign
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true, campaign: true },
  });

  if (!email) {
    console.warn(`[Worker] Email ${emailId} not found in database. Skipping.`);
    return;
  }

  // 2. State Check: If already SENT, skip safely (Idempotency Guard)
  if (email.status === 'SENT') {
    console.log(`[Worker] Duplicate/already processed job skipped: Email ${emailId} is already SENT.`);
    return;
  }

  // 3. State Check: If FAILED, do not resend automatically in this phase
  if (email.status === 'FAILED') {
    console.log(`[Worker] Email ${emailId} is marked FAILED. Automatic retry disabled in this phase. Skipping.`);
    return;
  }

  // 4. Message ID Recovery Guard:
  // If messageId is already populated, durable proof exists that SMTP accepted the message
  // in a previous execution before finalization completed. Finalize as SENT without re-dispatching.
  if (email.messageId) {
    console.log(
      `[Worker] Message ID recovery: Email ${emailId} already has durable messageId (${email.messageId}). Finalizing as SENT without re-dispatching to SMTP.`
    );
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt: email.sentAt || new Date(),
        error: null,
      },
    });
    return;
  }

  // 5. Ambiguous Crash Recovery State:
  // If record is in PROCESSING and messageId is NULL, a previous worker execution was interrupted.
  // Because SMTP acceptance cannot be inferred without durable evidence, automatic re-dispatch
  // risks causing duplicate delivery. Preserve record in PROCESSING for operational review.
  if (email.status === 'PROCESSING') {
    console.warn(
      `[Worker] Ambiguous crash state detected for email ${emailId}: status is PROCESSING but messageId is NULL. SMTP acceptance cannot be determined from durable state. Skipping automatic re-dispatch to prevent duplicate delivery.`
    );
    await prisma.email.update({
      where: { id: emailId },
      data: {
        error:
          'Worker interrupted during PROCESSING with no durable SMTP receipt. Preserved for operational review to prevent duplicate delivery.',
      },
    });
    return;
  }

  // 6. Atomic Transition Guard: SCHEDULED -> PROCESSING
  // Concurrency-safe state transition ensuring exactly one worker claims the scheduled email
  const updateResult = await prisma.email.updateMany({
    where: {
      id: emailId,
      status: 'SCHEDULED',
    },
    data: {
      status: 'PROCESSING',
      attempts: { increment: 1 },
    },
  });

  if (updateResult.count === 0) {
    console.log(
      `[Worker] Concurrency guard: Email ${emailId} could not transition to PROCESSING (already claimed or updated). Skipping.`
    );
    return;
  }

  // 7. Atomic Rate Limiting & Minimum Send Delay Check (Redis Lua Script)
  const reservation = await rateLimitService.reserveSendSlot({
    senderId: email.senderId,
    campaignId: email.campaignId,
    campaignHourlyLimit: email.campaign?.hourlyLimit,
    senderHourlyLimit: null,
  });

  if (!reservation.allowed) {
    // Revert status in PostgreSQL to SCHEDULED and undo attempts increment
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SCHEDULED',
        attempts: { decrement: 1 },
      },
    });

    const nextAvailableAtMs = reservation.nextAvailableAt || Date.now() + 1000;

    if (reservation.reason === 'HOURLY_LIMIT') {
      console.warn(
        `[RateLimit] Hourly limit hit for sender ${email.senderId} (${reservation.currentCount}/${reservation.limit}). Rescheduling job ${job.id} to ${new Date(nextAvailableAtMs).toISOString()}`
      );

      // Fire deduplicated Slack alert asynchronously (will not block or crash worker)
      slackService
        .notifyRateLimitHit({
          type: 'RATE_LIMIT_HIT',
          emailId: email.id,
          senderId: email.senderId,
          senderEmail: email.sender.email,
          recipient: email.recipient,
          scope: reservation.scope || 'sender',
          limit: reservation.limit || env.MAX_EMAILS_PER_HOUR,
          currentCount: reservation.currentCount || reservation.limit || env.MAX_EMAILS_PER_HOUR,
          nextAvailableAt: new Date(nextAvailableAtMs).toISOString(),
          timestamp: new Date().toISOString(),
        })
        .catch((slackErr) => {
          console.warn(`[Slack] Rate limit alert delivery warning:`, slackErr?.message || slackErr);
        });
    } else {
      console.log(
        `[RateLimit] Minimum send delay active for sender ${email.senderId}. Rescheduling job ${job.id} to ${new Date(nextAvailableAtMs).toISOString()}`
      );
    }

    // Move job back to delayed state natively in BullMQ and throw DelayedError
    // BullMQ does NOT count DelayedError as a failed attempt.
    await job.moveToDelayed(nextAvailableAtMs, token);
    throw new DelayedError();
  }

  const currentAttempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts || 3;
  console.log(`[SMTP] Sending email ${emailId} to ${email.recipient} (Attempt ${currentAttempt}/${maxAttempts})`);

  // 8. SMTP Dispatch Boundary
  let sendResult;
  try {
    sendResult = await emailSenderService.sendEmail({
      from: email.sender.email,
      to: email.recipient,
      subject: email.subject,
      body: email.body,
      attachments: (email.attachments as any) || undefined,
      auth: {
        user: email.sender.etherealUser,
        pass: email.sender.etherealPassword,
      },
    });
  } catch (smtpError) {
    const sanitizedError = sanitizeSmtpError(smtpError);
    console.error(`[SMTP] Delivery failed ${emailId}: ${sanitizedError}`);

    const isFinalAttempt = currentAttempt >= maxAttempts;

    if (isFinalAttempt) {
      // Mark as permanently FAILED only after exhausting configured BullMQ attempts
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'FAILED',
          error: sanitizedError,
        },
      });
      console.error(`[Worker] Email ${emailId} exhausted all ${maxAttempts} attempts. Marked as FAILED.`);
    } else {
      // Revert status to SCHEDULED so BullMQ retry can claim it cleanly on next attempt
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'SCHEDULED',
          error: sanitizedError,
        },
      });
      console.warn(`[Worker] Email ${emailId} failed attempt ${currentAttempt}/${maxAttempts}. Reverted to SCHEDULED for BullMQ retry.`);
    }

    throw new Error(sanitizedError);
  }

  // 9. Database Finalization Boundary
  // SMTP has accepted the message; now persist messageId and status=SENT
  console.log(`[SMTP] Email accepted ${emailId}`);
  console.log(`[SMTP] Message ID: ${sendResult.messageId}`);
  if (sendResult.previewUrl) {
    console.log(`[SMTP] Ethereal preview URL: ${sendResult.previewUrl}`);
  }

  try {
    if (__testDbFinalizeHook) {
      await __testDbFinalizeHook(emailId);
    }

    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        messageId: sendResult.messageId,
        error: null,
      },
    });
    console.log(`[Worker] Email ${emailId} finalized as SENT in PostgreSQL.`);
  } catch (dbError) {
    const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(
      `[CRITICAL] [SMTP/DB Boundary] Email ${emailId} was ACCEPTED by SMTP (Message ID: ${sendResult.messageId}), BUT PostgreSQL finalization to SENT failed: ${dbErrorMessage}. Duplicate delivery may occur if this job is retried.`
    );

    // Best-effort attempt to persist messageId and failure details for future recovery
    try {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          messageId: sendResult.messageId,
          error: `SMTP accepted (Message ID: ${sendResult.messageId}) but DB finalization failed: ${dbErrorMessage}`,
        },
      });
    } catch {
      // Database connection wholly unavailable
    }

    // Do NOT mark as SENT; throw error so BullMQ tracks the failure
    throw new Error(`SMTP accepted email, but database finalization failed: ${dbErrorMessage}`);
  }

  // 10. Elasticsearch Search Projection (Asynchronous)
  // Failures in search indexing must never interrupt email delivery or fail the job
  elasticsearchService
    .indexEmail({
      emailId: email.id,
      userId: email.campaign.userId,
      senderId: email.senderId,
      senderEmail: email.sender.email,
      campaignId: email.campaignId,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      status: 'SENT',
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: new Date().toISOString(),
      messageId: sendResult.messageId,
      createdAt: email.createdAt.toISOString(),
    })
    .catch((esError) => {
      console.warn(`[Elasticsearch] Failed to index email ${email.id}:`, esError?.message || esError);
    });
};

let emailWorker: Worker<EmailJobData> | null = null;

export const startEmailWorker = (): Worker<EmailJobData> => {
  if (!emailWorker) {
    emailWorker = new Worker<EmailJobData>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailJobData>, token?: string) => {
        return await processEmailJob(job, token);
      },
      {
        connection: redisConnectionOptions,
        concurrency: env.WORKER_CONCURRENCY,
      }
    );

    console.log(`[Worker] emailWorker started with concurrency: ${env.WORKER_CONCURRENCY}`);

    emailWorker.on('completed', (job) => {
      console.log(`[Worker] Job ${job.id} completed successfully.`);
    });

    emailWorker.on('failed', (job, err) => {
      if (err?.name === 'DelayedError') {
        return;
      }
      console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    });

    emailWorker.on('error', (err) => {
      console.error('[Worker] Internal worker error:', err.message);
    });
  }

  return emailWorker;
};

export const closeEmailWorker = async (): Promise<void> => {
  if (emailWorker) {
    console.log('[Worker] Worker shutdown initiated...');
    await emailWorker.close();
    emailWorker = null;
    console.log('[Worker] Worker shutdown complete.');
  }
};
