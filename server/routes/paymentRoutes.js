import { Router } from 'express';
import {
  getConfig,
  createRazorpayOrder,
  verifyPayment,
  markPaymentFailed,
} from '../controllers/paymentController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// paymentRoutes.js — Razorpay Test-Mode payments (Day 8).
//
// /config is PUBLIC (it returns only the public Key ID + whether payments are
// on). Every money-touching route requires a logged-in user; identity comes
// from the verified token (req.userId), never the body. The AGENT is given no
// payment tool, so it can never reach these endpoints on the user's behalf.
// ─────────────────────────────────────────────────────────────────────────

// GET  /api/payments/config          — is payment configured + public key id
router.get('/config', getConfig);

// POST /api/payments/razorpay/order  — create a Razorpay order (server amount)
router.post('/razorpay/order', requireAuth, createRazorpayOrder);
// POST /api/payments/razorpay/verify — verify signature, mark the order PAID
router.post('/razorpay/verify', requireAuth, verifyPayment);
// POST /api/payments/razorpay/failed — record a cancelled/dismissed checkout
router.post('/razorpay/failed', requireAuth, markPaymentFailed);

export default router;
