import { Router } from 'express';
import { getMyCart, saveMyCart } from '../controllers/cartController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Best-effort per-user cart mirror. Both routes require a logged-in user.
router.use(requireAuth);

// GET /api/cart  — load the mirrored cart
router.get('/', getMyCart);
// PUT /api/cart  — save the mirrored cart
router.put('/', saveMyCart);

export default router;
