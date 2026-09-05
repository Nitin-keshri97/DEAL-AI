import { Router } from 'express';
import { createOrder, previewOrder, listMyOrders, getMyOrder } from '../controllers/orderController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All order routes require a logged-in user. Identity is taken from the token.
router.use(requireAuth);

// POST /api/orders          — place an order (server computes the totals)
router.post('/', createOrder);
// POST /api/orders/preview  — authoritative checkout review (no order created)
router.post('/preview', previewOrder);
// GET  /api/orders          — list the current user's orders
router.get('/', listMyOrders);
// GET  /api/orders/:id      — one of the current user's orders
router.get('/:id', getMyOrder);

export default router;
