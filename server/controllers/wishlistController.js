import User from '../models/User.js';
import { isDbConnected } from '../config/db.js';

// ─────────────────────────────────────────────────────────────────────────
// wishlistController.js — per-user wishlist (requireAuth routes).
//
// The wishlist is stored as an array of product skus on the User document.
// Reads/writes are always scoped to req.userId (from the verified token) —
// a user can never read or modify another user's wishlist.
// ─────────────────────────────────────────────────────────────────────────

function dbGuard(res) {
  if (!isDbConnected()) {
    res.status(503).json({ success: false, error: 'Service temporarily unavailable.' });
    return false;
  }
  return true;
}

// GET /api/wishlist — return the current user's wishlist skus
export async function getWishlist(req, res) {
  if (!dbGuard(res)) return;
  try {
    const user = await User.findById(req.userId, { wishlist: 1 });
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    return res.json({ success: true, wishlist: user.wishlist || [] });
  } catch (err) {
    console.error('[DealAI] Get wishlist error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not load wishlist.' });
  }
}

// POST /api/wishlist/:sku — add a product sku to wishlist
export async function addToWishlist(req, res) {
  if (!dbGuard(res)) return;
  try {
    const sku = parseInt(req.params.sku, 10);
    if (!Number.isFinite(sku)) {
      return res.status(400).json({ success: false, error: 'Invalid product id.' });
    }
    await User.updateOne({ _id: req.userId }, { $addToSet: { wishlist: sku } });
    const user = await User.findById(req.userId, { wishlist: 1 });
    return res.json({ success: true, wishlist: user?.wishlist || [] });
  } catch (err) {
    console.error('[DealAI] Add to wishlist error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not update wishlist.' });
  }
}

// DELETE /api/wishlist/:sku — remove a product sku from wishlist
export async function removeFromWishlist(req, res) {
  if (!dbGuard(res)) return;
  try {
    const sku = parseInt(req.params.sku, 10);
    if (!Number.isFinite(sku)) {
      return res.status(400).json({ success: false, error: 'Invalid product id.' });
    }
    await User.updateOne({ _id: req.userId }, { $pull: { wishlist: sku } });
    const user = await User.findById(req.userId, { wishlist: 1 });
    return res.json({ success: true, wishlist: user?.wishlist || [] });
  } catch (err) {
    console.error('[DealAI] Remove from wishlist error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not update wishlist.' });
  }
}

// DELETE /api/wishlist — clear entire wishlist
export async function clearWishlist(req, res) {
  if (!dbGuard(res)) return;
  try {
    await User.updateOne({ _id: req.userId }, { $set: { wishlist: [] } });
    return res.json({ success: true, wishlist: [] });
  } catch (err) {
    console.error('[DealAI] Clear wishlist error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not clear wishlist.' });
  }
}
