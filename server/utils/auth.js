// ─────────────────────────────────────────────────────────────────────────
// auth.js — pure, dependency-free authentication primitives (Day 5).
//
// Uses ONLY Node's built-in `crypto` (no bcrypt / jsonwebtoken) to honour the
// "no unnecessary dependencies" constraint. Everything here is side-effect free
// and unit-testable (see server/test/auth.test.js).
//
// SECURITY:
//   • Passwords are hashed with scrypt + a per-password random salt. The plain
//     password is never stored and never logged.
//   • Password verification is constant-time (crypto.timingSafeEqual).
//   • Session tokens are HMAC-SHA256 signed over {uid, exp}. The signing secret
//     (AUTH_SECRET) lives ONLY on the server and is never returned to a client.
//   • verifyToken returns the userId only for an untampered, unexpired token.
// ─────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { readEnv } from '../config/loadEnv.js';

// ── Signing secret ────────────────────────────────────────────────────────
// Prefer a real AUTH_SECRET from server/.env. If it's missing we fall back to a
// random per-process secret so the server never crashes in dev — but tokens
// then die on restart, so we warn once. NEVER hard-code a real secret here.
let _ephemeralWarned = false;
let _ephemeralSecret = null;
function getSecret() {
  const configured = readEnv('AUTH_SECRET');
  if (configured) return configured;
  if (!_ephemeralWarned) {
    console.warn(
      '\n⚠️  AUTH_SECRET is not set in server/.env. Using an EPHEMERAL secret —\n' +
        '    login tokens will be invalidated on every server restart. Set a real\n' +
        '    value in production (see server/.env.example).\n'
    );
    _ephemeralWarned = true;
  }
  if (!_ephemeralSecret) _ephemeralSecret = crypto.randomBytes(48).toString('hex');
  return _ephemeralSecret;
}

// ── Password hashing (scrypt) ───────────────────────────────────────────────
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Hash a plain password → a self-describing string safe to store in MongoDB:
 *   "scrypt$<saltHex>$<hashHex>"
 * A fresh random salt is used every call, so two identical passwords produce
 * different hashes.
 */
export function hashPassword(plain) {
  const password = String(plain ?? '');
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Verify a plain password against a stored "scrypt$salt$hash" string.
 * Constant-time; returns false for any malformed input (never throws).
 */
export function verifyPassword(plain, stored) {
  try {
    if (typeof stored !== 'string') return false;
    const [scheme, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(plain ?? ''), salt, expected.length);
    // Lengths must match for timingSafeEqual; guard first.
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── Session tokens (HMAC-signed, stateless) ──────────────────────────────────
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function hmac(data) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest();
}

/**
 * Sign a token for a user id. Format: "<payloadB64url>.<sigB64url>" where
 * payload = { uid, exp }. Tamper-evident (any change breaks the HMAC).
 */
export function signToken(userId, { ttlMs = TOKEN_TTL_MS } = {}) {
  const payload = { uid: String(userId), exp: Date.now() + ttlMs };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(payloadB64));
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a token → the userId string, or null if missing / malformed / tampered
 * / expired. Constant-time signature comparison. Never throws.
 */
export function verifyToken(token) {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;

    const expectedSig = b64url(hmac(payloadB64));
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || typeof payload.uid !== 'string') return null;
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

/** Pull a bearer token out of an Authorization header ("Bearer <token>"). */
export function tokenFromHeader(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : null;
}

// ── Input validators (shared by controller + tests) ──────────────────────────
export const PASSWORD_MIN_LEN = 8;
export const NAME_MAX_LEN = 60;

/** Lowercase + trim an email for consistent storage / lookup. */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** A pragmatic (not RFC-exhaustive) email check. */
export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length >= 3 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Return a human-readable problem with a password, or null if it's acceptable.
 * Kept deliberately simple: presence + minimum length.
 */
export function passwordProblem(pw) {
  const p = String(pw ?? '');
  if (!p) return 'Password is required.';
  if (p.length < PASSWORD_MIN_LEN) return `Password must be at least ${PASSWORD_MIN_LEN} characters.`;
  if (p.length > 200) return 'Password is too long.';
  return null;
}

/** Return a problem with a display name, or null if acceptable. */
export function nameProblem(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'Name is required.';
  if (n.length > NAME_MAX_LEN) return `Name must be ${NAME_MAX_LEN} characters or fewer.`;
  return null;
}
