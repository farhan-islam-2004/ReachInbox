import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../config/redis';

export interface EmailJobData {
  emailId: string;
}

export const EMAIL_QUEUE_NAME = 'emailQueue';

export const emailQueue = new Queue<EmailJobData, void, string>(EMAIL_QUEUE_NAME, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const addEmailJob = async (emailId: string, delayMs: number) => {
  const jobId = `email_${emailId}`;
  return await emailQueue.add(
    'send-email',
    { emailId },
    {
      jobId,
      delay: Math.max(0, delayMs),
    }
  );
};

export const addEmailJobs = async (jobs: { emailId: string; delayMs: number }[]) => {
  return await emailQueue.addBulk(
    jobs.map((j) => ({
      name: 'send-email',
      data: { emailId: j.emailId },
      opts: {
        jobId: `email_${j.emailId}`,
        delay: Math.max(0, j.delayMs),
      },
    }))
  );
};

export const closeEmailQueue = async (): Promise<void> => {
  await emailQueue.close();
};
