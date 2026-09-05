import { Router } from 'express';
import { getWishlist, addToWishlist, removeFromWishlist, clearWishlist } from '../controllers/wishlistController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All wishlist routes require authentication
router.use(requireAuth);

// GET  /api/wishlist       — get the current user's wishlist
router.get('/', getWishlist);
// POST /api/wishlist/:sku  — add a product to wishlist
router.post('/:sku', addToWishlist);
// DELETE /api/wishlist/:sku — remove a product from wishlist
router.delete('/:sku', removeFromWishlist);
// DELETE /api/wishlist     — clear entire wishlist
router.delete('/', clearWishlist);

export default router;
