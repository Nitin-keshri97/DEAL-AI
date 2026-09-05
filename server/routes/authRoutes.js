import { Router } from 'express';
import { signup, login, me, updateProfile } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/signup   — create an account            (public)
router.post('/signup', signup);
// POST /api/auth/login    — obtain a session token        (public)
router.post('/login', login);
// GET  /api/auth/me       — the current session's user     (protected)
router.get('/me', requireAuth, me);
// PUT  /api/auth/profile  — edit display name              (protected)
router.put('/profile', requireAuth, updateProfile);

export default router;
