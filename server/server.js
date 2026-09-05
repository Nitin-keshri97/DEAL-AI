// Must be first: loads server/.env into process.env before anything reads it.
import './config/loadEnv.js';
import express from 'express';
import cors from 'cors';

import { connectDB, isDbConnected } from './config/db.js';
import dealRoutes from './routes/dealRoutes.js';
import productRoutes from './routes/productRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import authRoutes from './routes/authRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import wishlistRoutes from './routes/wishlistRoutes.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

// ── CORS ──────────────────────────────────────────────────────────────────
// Allow only the known frontend origins. In production, set CLIENT_ORIGIN to
// your deployed frontend URL(s) — never allow arbitrary origins.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server / tools (no Origin header).
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  })
);

// ── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'DealAI API', db: isDbConnected() ? 'connected' : 'disconnected' });
});

// ── Safe product reads (listing, detail, reviews — never expose costPrice) ────
app.use('/api/products', productRoutes);

// ── Authentication (signup / login / me / profile) ───────────────────────────
app.use('/api/auth', authRoutes);

// ── Orders (create + read; all require a logged-in user) ──────────────────────
app.use('/api/orders', orderRoutes);

// ── Payments (Razorpay Test-Mode: order creation + server-side verification) ──
app.use('/api/payments', paymentRoutes);

// ── Per-user cart mirror (best-effort persistence) ────────────────────────────
app.use('/api/cart', cartRoutes);

// ── Per-user wishlist ─────────────────────────────────────────────────────────
app.use('/api/wishlist', wishlistRoutes);

// ── DealAI shopping agent (real multi-step tool loop) ─────────────────────────
app.use('/api/agent', agentRoutes);

// ── Deal negotiation ─────────────────────────────────────────────────────────
app.use('/api/deals', dealRoutes);

// 404 for unknown API routes.
app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

const PORT = process.env.PORT || 5000;

await connectDB();
app.listen(PORT, () => {
  console.log(`🚀 DealAI API running on http://localhost:${PORT}`);
  console.log(`   Health:     http://localhost:${PORT}/api/health`);
  console.log(`   Products:   GET  http://localhost:${PORT}/api/products`);
  console.log(`   Search:     GET  http://localhost:${PORT}/api/products/search`);
  console.log(`   Auth:       POST http://localhost:${PORT}/api/auth/login`);
  console.log(`   Orders:     POST http://localhost:${PORT}/api/orders`);
  console.log(`   Payments:   POST http://localhost:${PORT}/api/payments/razorpay/order`);
  console.log(`   Wishlist:   GET  http://localhost:${PORT}/api/wishlist`);
  console.log(`   Agent:      POST http://localhost:${PORT}/api/agent/chat`);
  console.log(`   Negotiate:  POST http://localhost:${PORT}/api/deals/negotiate`);
});
