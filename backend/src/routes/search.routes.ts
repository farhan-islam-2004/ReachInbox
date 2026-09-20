import { Router } from 'express';
import { searchEmailsController } from '../controllers/search.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// Protect search endpoint so only authenticated users can search their own emails
router.get('/emails', requireAuth, searchEmailsController);

export default router;
