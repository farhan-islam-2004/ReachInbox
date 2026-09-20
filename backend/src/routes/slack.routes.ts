import { Router } from 'express';
import {
  connectSlackController,
  slackCallbackController,
  disconnectSlackController,
  slackStatusController,
} from '../controllers/slack.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/connect', requireAuth, connectSlackController);
router.get('/callback', slackCallbackController);
router.get('/status', requireAuth, slackStatusController);
router.post('/disconnect', requireAuth, disconnectSlackController);

export default router;
