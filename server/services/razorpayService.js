// ─────────────────────────────────────────────────────────────────────────
// razorpayService.js — real Razorpay Test-Mode payments, dependency-free (Day 8).
//
// Uses ONLY Node's built-in `crypto` + global `fetch` (no `razorpay` SDK) to
// honour the project's "no unnecessary dependencies" rule. Razorpay's Orders API
// is a single HTTPS POST (HTTP Basic auth), and payment verification is an
// HMAC-SHA256 of "<order_id>|<payment_id>" keyed by the Key Secret — the exact
// primitives already used in utils/auth.js and the Gemini client.
//
// SECURITY:
//   • RAZORPAY_KEY_SECRET lives ONLY here (server-side) and is never returned to
//     a client nor logged. Only the public Key ID is ever exposed.
//   • Signature verification is constant-time (crypto.timingSafeEqual) and never
//     throws on malformed input.
//   • The amount charged is ALWAYS computed server-side (paise) — the caller
//     passes a trusted amount derived from buildCheckoutSummary; the browser's
//     amount is never trusted.
// ─────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { readEnv } from '../config/loadEnv.js';

const RAZORPAY_ORDERS_URL = 'https://api.razorpay.com/v1/orders';

/** Both keys present → online payments are enabled. */
export function isConfigured() {
  return Boolean(readEnv('RAZORPAY_KEY_ID') && readEnv('RAZORPAY_KEY_SECRET'));
}

/** The PUBLIC Key ID (safe to send to the browser). '' when unconfigured. */
export function getPublicKeyId() {
  return readEnv('RAZORPAY_KEY_ID');
}

/** Rupees → integer paise (Razorpay's smallest unit). Guarded, always ≥ 0. */
export function toPaise(rupees) {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * The signature Razorpay Checkout returns for a successful payment:
 *   HMAC_SHA256(`${orderId}|${paymentId}`, keySecret)  (lowercase hex)
 * Pure + deterministic — unit-tested with a known secret. Exported so the
 * live E2E can simulate Razorpay's signed callback without a browser.
 */
export function expectedSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', String(secret ?? ''))
    .update(`${String(orderId ?? '')}|${String(paymentId ?? '')}`)
    .digest('hex');
}

/**
 * Verify a Razorpay Checkout callback signature, constant-time. Returns a plain
 * boolean and NEVER throws (malformed input → false). The secret defaults to
 * RAZORPAY_KEY_SECRET from the environment; tests may pass one explicitly.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature, secret } = {}) {
  try {
    const key = secret != null ? String(secret) : readEnv('RAZORPAY_KEY_SECRET');
    if (!key || !orderId || !paymentId || typeof signature !== 'string' || !signature) {
      return false;
    }
    const expected = expectedSignature(orderId, paymentId, key);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    // timingSafeEqual requires equal lengths; a length mismatch is already a fail.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Create a Razorpay Order (server → Razorpay) for a TRUSTED amount in paise.
 * Returns { id, amount, currency, status, receipt }. Throws a SAFE Error on any
 * failure (never leaks the secret or the raw response). Requires isConfigured().
 *
 * @param {{ amountPaise:number, currency?:string, receipt?:string, notes?:object }} p
 */
export async function createRazorpayOrder({ amountPaise, currency = 'INR', receipt, notes } = {}) {
  const keyId = readEnv('RAZORPAY_KEY_ID');
  const keySecret = readEnv('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) {
    throw new Error('Razorpay is not configured.');
  }
  const amount = Math.round(Number(amountPaise));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid payment amount.');
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  let res;
  try {
    res = await fetch(RAZORPAY_ORDERS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
        notes: notes || {},
      }),
    });
  } catch {
    // Network / DNS / TLS — do not surface internals.
    throw new Error('Could not reach the payment gateway. Please try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok || !data || !data.id) {
    // Razorpay error bodies look like { error: { description } } — surface only
    // the human description, never the request/auth details.
    const description = data?.error?.description || 'Payment gateway rejected the order.';
    console.error('[DealAI] Razorpay order creation failed:', res?.status, description);
    throw new Error(description);
  }

  return {
    id: data.id,
    amount: data.amount,
    currency: data.currency,
    status: data.status,
    receipt: data.receipt,
  };
}
