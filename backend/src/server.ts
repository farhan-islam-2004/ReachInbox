import app from './app';
import { env } from './config/env';
import { startEmailWorker, closeEmailWorker } from './workers/email.worker';
import { closeEmailQueue } from './queues/email.queue';
import { closeRedisConnection } from './config/redis';
import { emailSenderService } from './services/email-sender.service';

// Start HTTP server
const server = app.listen(env.PORT, () => {
  console.log(`ReachInbox backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Non-blocking SMTP verification on startup if credentials exist
const etherealUser = process.env.ETHEREAL_USER || env.ETHEREAL_USER;
const etherealPassword = process.env.ETHEREAL_PASSWORD || env.ETHEREAL_PASSWORD;

if (etherealUser && etherealPassword) {
  emailSenderService
    .verifyConnection({ user: etherealUser, pass: etherealPassword })
    .then((connected) => {
      if (connected) {
        console.log('[SMTP] Ethereal SMTP transporter connected and verified successfully.');
      } else {
        console.warn('[SMTP] Warning: Ethereal SMTP transporter verification failed.');
      }
    })
    .catch((err) => {
      console.warn('[SMTP] Warning during SMTP startup check:', err.message);
    });
}

// Non-blocking Elasticsearch index initialization
import { elasticsearchService } from './services/elasticsearch.service';
elasticsearchService
  .ensureIndex()
  .then(() => {
    console.log('[Elasticsearch] Index verified on startup.');
  })
  .catch((err) => {
    console.warn('[Elasticsearch] Warning during startup index check:', err.message);
  });

// BullMQ worker runs in a dedicated worker process (worker.ts), never inside the web server in production
let worker: any = null;
if (env.NODE_ENV !== 'production' && process.env.START_WORKER !== 'false') {
  worker = startEmailWorker();
} else if (process.env.START_WORKER === 'true') {
  worker = startEmailWorker();
}

let isShuttingDown = false;

const handleShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Gracefully shutting down...`);

  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      if (worker) {
        await closeEmailWorker();
      }
      await closeEmailQueue();
      await closeRedisConnection();
      console.log('BullMQ worker and queues closed cleanly.');
    } catch (err) {
      console.error('Error during worker/queue cleanup:', err);
    }
    process.exit(0);
  });
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
