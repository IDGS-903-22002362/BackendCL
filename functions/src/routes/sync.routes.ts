import { Router } from 'express';
import { syncAll } from '../controllers/sync.controller';

const router = Router();

router.post('/sync', syncAll);

export default router;