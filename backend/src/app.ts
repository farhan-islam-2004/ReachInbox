import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './config/env';
import routes from './routes';
import { emailQueue } from './queues/email.queue';
import { notFoundHandler } from './middleware/not-found.middleware';
import { errorHandler } from './middleware/error.middleware';

const app = express();

// Security and utility middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Ensure Bull Board UI scripts and styles render cleanly
  })
);
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Bull Board monitoring dashboard mounted at /admin/queues
const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullBoardAdapter,
});

app.use('/admin/queues', bullBoardAdapter.getRouter());

// API routes
app.use('/api', routes);

// 404 and error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
