import { Router } from 'express';
import {
  googleLoginController,
  googleCallbackController,
  meController,
  logoutController,
  authStatusController,
} from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/google', googleLoginController);
router.get('/google/callback', googleCallbackController);
router.get('/me', requireAuth, meController);
router.post('/logout', requireAuth, logoutController);
router.get('/status', authStatusController);

export default router;
