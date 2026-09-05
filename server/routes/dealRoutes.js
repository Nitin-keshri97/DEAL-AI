import { Router } from 'express';
import { negotiate } from '../controllers/dealController.js';

const router = Router();

// POST /api/deals/negotiate — run a negotiation on the given cart + offer.
router.post('/negotiate', negotiate);

export default router;
