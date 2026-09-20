import { env } from './config/env';
import { startEmailWorker, closeEmailWorker } from './workers/email.worker';
import { closeEmailQueue } from './queues/email.queue';
import { closeRedisConnection } from './config/redis';
import { emailSenderService } from './services/email-sender.service';
import { elasticsearchService } from './services/elasticsearch.service';

console.log(`[Worker Process] Starting ReachInbox dedicated email worker (${env.NODE_ENV})...`);

// Non-blocking SMTP verification on startup
const etherealUser = process.env.ETHEREAL_USER || env.ETHEREAL_USER;
const etherealPassword = process.env.ETHEREAL_PASSWORD || env.ETHEREAL_PASSWORD;

if (etherealUser && etherealPassword) {
  emailSenderService
    .verifyConnection({ user: etherealUser, pass: etherealPassword })
    .then((connected) => {
      if (connected) {
        console.log('[Worker Process] Ethereal SMTP transporter connected and verified.');
      } else {
        console.warn('[Worker Process] Warning: Ethereal SMTP verification failed.');
      }
    })
    .catch((err) => {
      console.warn('[Worker Process] Warning during SMTP startup check:', err.message);
    });
}

// Non-blocking Elasticsearch index check
elasticsearchService
  .ensureIndex()
  .then(() => {
    console.log('[Worker Process] Elasticsearch index verified.');
  })
  .catch((err) => {
    console.warn('[Worker Process] Warning during Elasticsearch index check:', err.message);
  });

// Start BullMQ Worker
const worker = startEmailWorker();

let isShuttingDown = false;
const handleShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker Process] Received ${signal}. Gracefully shutting down...`);

  try {
    await closeEmailWorker();
    await closeEmailQueue();
    await closeRedisConnection();
    console.log('[Worker Process] Closed cleanly.');
  } catch (err) {
    console.error('[Worker Process] Error during cleanup:', err);
  }
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
