// Standalone Razorpay payment-primitive tests — no database, no network required.
// Run with:  node server/test/payment.test.js
//
// Covers the SECURITY-CRITICAL crypto in server/services/razorpayService.js:
// the payment-signature HMAC (Razorpay's documented algorithm), constant-time
// verification (correct vs tampered vs wrong-secret vs malformed), amount→paise
// conversion, and the configured/public-key helpers. The success path of the
// controller (marking an order PAID) is exercised live in server/test/day8.e2e.mjs.

import crypto from 'node:crypto';
import {
  isConfigured,
  getPublicKeyId,
  toPaise,
  expectedSignature,
  verifyPaymentSignature,
} from '../services/razorpayService.js';

// ── Tiny harness (same style as the other server tests) ───────────────────────
let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\nDealAI Razorpay payment-primitive tests\n');

const SECRET = 'rzp_test_secret_ABC123'; // a stand-in Key Secret for the pure tests
const ORDER = 'order_Nabc123XYZ';
const PAYMENT = 'pay_Ndef456UVW';

// ── Amount → paise ────────────────────────────────────────────────────────────
test('toPaise converts whole rupees to integer paise', () => {
  assert(toPaise(27360) === 2736000, '₹27,360 → 2736000 paise');
  assert(toPaise(25740) === 2574000, '₹25,740 → 2574000 paise');
  assert(toPaise(1) === 100, '₹1 → 100 paise');
});

test('toPaise rounds fractional rupees and guards junk/negatives', () => {
  assert(toPaise(99.99) === 9999, 'rounds 99.99 → 9999');
  assert(toPaise(0.1) === 10, 'rounds 0.1 → 10');
  assert(toPaise(0) === 0, 'zero → 0');
  assert(toPaise(-5) === 0, 'negative → 0 (never charge a negative)');
  assert(toPaise('abc') === 0, 'non-numeric → 0');
  assert(toPaise(undefined) === 0, 'undefined → 0');
});

// ── Signature generation (Razorpay's documented algorithm) ─────────────────────
test('expectedSignature matches HMAC_SHA256("orderId|paymentId", secret) hex', () => {
  const manual = crypto.createHmac('sha256', SECRET).update(`${ORDER}|${PAYMENT}`).digest('hex');
  assert(expectedSignature(ORDER, PAYMENT, SECRET) === manual, 'matches manual HMAC');
});

test('expectedSignature is deterministic and input-sensitive', () => {
  const s1 = expectedSignature(ORDER, PAYMENT, SECRET);
  const s2 = expectedSignature(ORDER, PAYMENT, SECRET);
  assert(s1 === s2, 'same inputs → same signature');
  assert(expectedSignature(ORDER, 'pay_other', SECRET) !== s1, 'different payment → different sig');
  assert(expectedSignature('order_other', PAYMENT, SECRET) !== s1, 'different order → different sig');
  assert(expectedSignature(ORDER, PAYMENT, 'other_secret') !== s1, 'different secret → different sig');
});

// ── Signature verification (the security core) ─────────────────────────────────
test('SECURITY: verifyPaymentSignature accepts a correctly-signed payload', () => {
  const signature = expectedSignature(ORDER, PAYMENT, SECRET);
  assert(
    verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature, secret: SECRET }) === true,
    'a valid signature verifies'
  );
});

test('SECURITY: verifyPaymentSignature rejects a tampered payment id', () => {
  const signature = expectedSignature(ORDER, PAYMENT, SECRET);
  assert(
    verifyPaymentSignature({ orderId: ORDER, paymentId: 'pay_TAMPERED', signature, secret: SECRET }) === false,
    'tampered paymentId must fail'
  );
});

test('SECURITY: verifyPaymentSignature rejects a tampered order id', () => {
  const signature = expectedSignature(ORDER, PAYMENT, SECRET);
  assert(
    verifyPaymentSignature({ orderId: 'order_TAMPERED', paymentId: PAYMENT, signature, secret: SECRET }) === false,
    'tampered orderId must fail'
  );
});

test('SECURITY: verifyPaymentSignature rejects a signature made with the wrong secret', () => {
  const forged = expectedSignature(ORDER, PAYMENT, 'attacker_secret');
  assert(
    verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: forged, secret: SECRET }) === false,
    'a signature forged without the real secret must fail'
  );
});

test('verifyPaymentSignature is robust to malformed input (never throws)', () => {
  const good = expectedSignature(ORDER, PAYMENT, SECRET);
  assert(verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: '', secret: SECRET }) === false, 'empty signature');
  assert(verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: null, secret: SECRET }) === false, 'null signature');
  assert(verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: 'deadbeef', secret: SECRET }) === false, 'short/length-mismatch signature');
  assert(verifyPaymentSignature({ orderId: '', paymentId: '', signature: good, secret: SECRET }) === false, 'missing ids');
  assert(verifyPaymentSignature({ orderId: ORDER, paymentId: PAYMENT, signature: good, secret: '' }) === false, 'missing secret → cannot verify');
  assert(verifyPaymentSignature() === false, 'no args at all');
});

// ── Config helpers ──────────────────────────────────────────────────────────
test('isConfigured / getPublicKeyId reflect the environment', () => {
  const savedId = process.env.RAZORPAY_KEY_ID;
  const savedSecret = process.env.RAZORPAY_KEY_SECRET;
  try {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    assert(isConfigured() === false, 'no keys → not configured');
    assert(getPublicKeyId() === '', 'no keys → empty public key');

    process.env.RAZORPAY_KEY_ID = 'rzp_test_public123';
    process.env.RAZORPAY_KEY_SECRET = 'secret456';
    assert(isConfigured() === true, 'both keys → configured');
    assert(getPublicKeyId() === 'rzp_test_public123', 'exposes ONLY the public key id');

    // Key ID alone (no secret) is not enough to be "configured".
    delete process.env.RAZORPAY_KEY_SECRET;
    assert(isConfigured() === false, 'key id without secret → not configured');
  } finally {
    if (savedId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = savedId;
    if (savedSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = savedSecret;
  }
});

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('  ✓', name);
      passed++;
    } catch (e) {
      console.error('  ✗', name, '\n      ', e.message);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
