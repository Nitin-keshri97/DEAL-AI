import { verifyToken, tokenFromHeader } from '../utils/auth.js';

// ─────────────────────────────────────────────────────────────────────────
// auth.js (middleware) — turns an "Authorization: Bearer <token>" header into a
// trusted req.userId.
//
// SECURITY: the user identity ALWAYS comes from the cryptographically-verified
// token — NEVER from the request body or a query param. Protected controllers
// read req.userId only. A missing/expired/tampered token yields no identity.
// ─────────────────────────────────────────────────────────────────────────

/** Extract a verified userId from the request, or null. */
function identify(req) {
  const token = tokenFromHeader(req.headers?.authorization);
  if (!token) return null;
  return verifyToken(token); // null if invalid / expired / tampered
}

/** Hard gate: 401 unless a valid token is present. Sets req.userId. */
export function requireAuth(req, res, next) {
  const userId = identify(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Please log in to continue.' });
  }
  req.userId = userId;
  next();
}

/** Soft gate: sets req.userId when a valid token is present, else continues
 *  anonymously. Used by the agent so guests still get a (non-personalized) reply. */
export function optionalAuth(req, _res, next) {
  req.userId = identify(req) || null;
  next();
}
