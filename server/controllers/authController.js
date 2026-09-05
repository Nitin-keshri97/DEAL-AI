import User, { AVATAR_COLORS } from '../models/User.js';
import { isDbConnected } from '../config/db.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  normalizeEmail,
  isValidEmail,
  passwordProblem,
  nameProblem,
} from '../utils/auth.js';

// ─────────────────────────────────────────────────────────────────────────
// authController.js — signup / login / me / updateProfile.
//
// SECURITY:
//   • Passwords are hashed with scrypt before storage; the plaintext is used
//     only to hash/verify and is never logged or returned.
//   • Responses return user.toSafeJSON() — never passwordHash.
//   • Login failures are deliberately vague ("Incorrect email or password") so
//     we don't reveal whether an email exists (avoids user enumeration).
//   • The auth token is derived from the created/verified user id server-side.
// ─────────────────────────────────────────────────────────────────────────

function dbGuard(res) {
  if (!isDbConnected()) {
    res.status(503).json({ success: false, error: 'Accounts are temporarily unavailable. Please try again shortly.' });
    return false;
  }
  return true;
}

const pickAvatarColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

/** Shape the successful-auth response consistently for signup + login. */
function authResponse(res, user, status = 200) {
  const token = signToken(String(user._id));
  return res.status(status).json({ success: true, token, user: user.toSafeJSON() });
}

// POST /api/auth/signup  { name, email, password, confirmPassword? }
export async function signup(req, res) {
  if (!dbGuard(res)) return;
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const confirm = typeof body.confirmPassword === 'string' ? body.confirmPassword : undefined;

    const nErr = nameProblem(name);
    if (nErr) return res.status(400).json({ success: false, error: nErr });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    const pErr = passwordProblem(password);
    if (pErr) return res.status(400).json({ success: false, error: pErr });
    if (confirm !== undefined && confirm !== password) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    // Reject duplicates up front (the unique index is the hard backstop).
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ success: false, error: 'An account with that email already exists.' });

    const user = await User.create({
      name,
      email,
      passwordHash: hashPassword(password),
      avatarColor: pickAvatarColor(),
    });
    return authResponse(res, user, 201);
  } catch (err) {
    // Handle a race on the unique index gracefully.
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, error: 'An account with that email already exists.' });
    }
    console.error('[DealAI] Signup error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not create your account. Please try again.' });
  }
}

// POST /api/auth/login  { email, password }
export async function login(req, res) {
  if (!dbGuard(res)) return;
  try {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    // Same generic message whether the email is unknown or the password is wrong.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
    }
    return authResponse(res, user);
  } catch (err) {
    console.error('[DealAI] Login error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not log you in. Please try again.' });
  }
}

// GET /api/auth/me  (requireAuth) — the current session's user.
export async function me(req, res) {
  if (!dbGuard(res)) return;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ success: false, error: 'Session no longer valid. Please log in again.' });
    return res.json({ success: true, user: user.toSafeJSON() });
  } catch (err) {
    console.error('[DealAI] /me error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not load your profile.' });
  }
}

// PUT /api/auth/profile  (requireAuth)  { name? } — editable profile fields.
export async function updateProfile(req, res) {
  if (!dbGuard(res)) return;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ success: false, error: 'Session no longer valid. Please log in again.' });

    const body = req.body || {};
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      const nErr = nameProblem(name);
      if (nErr) return res.status(400).json({ success: false, error: nErr });
      user.name = name;
    }
    // Email/password changes are intentionally out of scope (see plan) — we only
    // let the customer edit their display name here.

    await user.save();
    return res.json({ success: true, user: user.toSafeJSON() });
  } catch (err) {
    console.error('[DealAI] Update profile error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not update your profile.' });
  }
}
