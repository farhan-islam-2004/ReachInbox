import { Router } from 'express';
import {
  scheduleEmailController,
  scheduleBatchController,
  getEmailByIdController,
  listEmailsController,
  listSendersController,
} from '../controllers/email.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// Protect all email management routes with authentication
router.use(requireAuth);

router.get('/', listEmailsController);
router.get('/senders', listSendersController);
router.post('/schedule', scheduleEmailController);
router.post('/schedule-batch', scheduleBatchController);
router.get('/:id', getEmailByIdController);

export default router;
