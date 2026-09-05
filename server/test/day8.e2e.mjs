// ─────────────────────────────────────────────────────────────────────────
// server/test/day8.e2e.mjs — LIVE end-to-end for DAY 8 (Razorpay Test-Mode pay).
//
// NOT part of `test:server` (that stays offline/deterministic). Drives the full
// real-payment pipeline over HTTP the way the browser does — EXCEPT the Razorpay
// Checkout popup itself, which needs a browser + a human test card. Instead we
// reproduce EXACTLY what Razorpay's client sends back after a successful payment:
// a signature = HMAC_SHA256(`${order_id}|${payment_id}`, KEY_SECRET). We compute
// that here with the SAME server secret (imported expectedSignature + readEnv),
// so signature verification is exercised for real, end to end, without a browser.
//
//   signup → agent shop → cart → negotiate → accept → previewOrder
//   (if configured)  create order (server amount, bogus client amount ignored)
//                    → simulate signed callback → verify (PAID) → duplicate (no-op)
//                    → invalid signature (400, stays unpaid) → empty cart (400)
//                    → unavailable product (400) → My Orders (PAID shown, pending
//                    hidden) → Order detail matches
//   (if NOT configured)  assert config shape + create-order 503 + print notice.
//
// Run:  node server/test/day8.e2e.mjs   (server must be up + reach Mongo;
//       live payment branch also needs RAZORPAY_KEY_ID/SECRET set in server/.env)
// ─────────────────────────────────────────────────────────────────────────

import { toPaise, expectedSignature } from '../services/razorpayService.js';
import { readEnv } from '../config/loadEnv.js';

const BASE = process.env.E2E_BASE || 'http://localhost:5000';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.error('  ✗', msg); } };
const info = (msg) => console.log('    •', msg);

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const client = { sessionId: undefined, token: null, cart: [] };
const authed = (extra = {}) => {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (client.token) h.Authorization = `Bearer ${client.token}`;
  return h;
};

function applyCartActions(actions = []) {
  for (const a of actions) {
    const id = Number(a.productId);
    if (a.op === 'clear') { client.cart = []; continue; }
    if (a.op === 'add') {
      const line = client.cart.find((l) => l.productId === id);
      if (line) line.quantity += a.quantity || 1;
      else client.cart.push({ productId: id, quantity: a.quantity || 1 });
    } else if (a.op === 'remove') {
      client.cart = client.cart.filter((l) => l.productId !== id);
    } else if (a.op === 'update') {
      const line = client.cart.find((l) => l.productId === id);
      if (line) line.quantity = a.quantity;
    }
  }
}

async function chat(message) {
  const { data } = await api('/api/agent/chat', {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ message, cart: client.cart, sessionId: client.sessionId, history: [] }),
  });
  if (!data || !data.success) throw new Error('agent chat failed: ' + JSON.stringify(data));
  if (data.sessionId) client.sessionId = data.sessionId;
  applyCartActions(data.cartActions);
  return data;
}

// Secrets that must NEVER appear in any client-facing payload.
const SECRET_KEYS = ['costPrice', 'passwordHash', 'margin', 'floorPrice', 'floor', 'keySecret', 'razorpaySignature', 'RAZORPAY_KEY_SECRET'];
const leaks = (obj) => (obj ? SECRET_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(obj, k)) : []);
const anyLeaks = (arr) => (arr || []).flatMap(leaks);

(async () => {
  console.log('\nDealAI DAY 8 — live Razorpay Test-Mode payment + verified orders\n');
  console.log(`  base: ${BASE}\n`);

  // ── Catalogue + auth ────────────────────────────────────────────────────────
  const prod = await api('/api/products');
  const products = prod.data?.products || [];
  ok(prod.status === 200 && products.length > 0, `catalogue loaded (${products.length} products)`);

  const email = `day8_${Date.now()}@example.com`;
  const signup = await api('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Day Eight', email, password: 'secret123', confirmPassword: 'secret123' }),
  });
  ok(signup.status === 201 && signup.data?.token, `signup ok (${signup.status})`);
  client.token = signup.data?.token;
  const userId = signup.data?.user?.id;
  ok(!!userId, `authenticated user id present (${userId})`);

  // ── Agent shop → cart (real agent path; deterministic fallback guarantees a cart) ─
  console.log('\n  ▶ agent shop: "Mujhe ek acha phone chahiye"');
  const r1 = await chat('Mujhe ek acha phone chahiye');
  info(r1.message?.slice(0, 140));
  console.log('  ▶ "Isko cart mein add karo"');
  let r2 = await chat('Isko cart mein add karo');
  info(r2.message?.slice(0, 140));
  if (!client.cart.length && (r2.pendingConfirmation || /which|kaun|colour|color|size|variant|konsa|kaunsa/i.test(r2.message || ''))) {
    r2 = await chat('Haan wahi, add kar do');
    info(r2.message?.slice(0, 140));
  }
  if (!client.cart.length) {
    // Payment pipeline (not the agent) is under test here — guarantee a real cart.
    const p = products.find((x) => Number(x.price) > 0) || products[0];
    client.cart.push({ productId: Number(p.sku), quantity: 1 });
    info(`agent did not add; deterministically added sku ${p.sku} so payment can be exercised`);
  }
  ok(client.cart.length > 0, `cart has ${client.cart.length} real line(s): ${JSON.stringify(client.cart)}`);

  // ── Negotiate + accept (best-effort; day7 proves this deeply — here it's context) ─
  console.log('\n  ▶ "Ab best deal lao" then "Deal accept karo"');
  try { info((await chat('Ab best deal lao')).message?.slice(0, 140)); } catch { /* non-fatal */ }
  try { info((await chat('Deal accept karo')).message?.slice(0, 140)); } catch { /* non-fatal */ }

  // ── Authoritative server total (the ONLY source of truth for the amount) ─────
  const pv = await api('/api/orders/preview', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ items: client.cart, sessionId: client.sessionId }),
  });
  const summary = pv.data?.summary;
  ok(pv.status === 200 && summary && Number(summary.finalTotal) > 0,
    `previewOrder → server finalTotal ₹${summary?.finalTotal} (subtotal ₹${summary?.subtotal}, negotiated −₹${summary?.negotiatedSavings || 0})`);
  ok(anyLeaks([summary]).length === 0, 'checkout summary carries no secret');
  const serverPaise = toPaise(summary?.finalTotal);
  info(`server-authoritative amount = ${serverPaise} paise`);

  // ── Payment configuration (public; must never leak the secret) ──────────────
  console.log('\n  ▶ GET /api/payments/config');
  const cfg = await api('/api/payments/config');
  ok(cfg.status === 200 && cfg.data?.success === true && typeof cfg.data?.configured === 'boolean',
    `config shape ok (configured=${cfg.data?.configured})`);
  ok(anyLeaks([cfg.data]).length === 0 && !('keySecret' in (cfg.data || {})),
    'config exposes only the public keyId — no secret');

  if (!cfg.data?.configured) {
    // ── NOT-CONFIGURED branch ─────────────────────────────────────────────────
    ok(cfg.data?.keyId === '', 'unconfigured → empty public keyId');
    const created = await api('/api/payments/razorpay/order', {
      method: 'POST', headers: authed(),
      body: JSON.stringify({ items: client.cart, sessionId: client.sessionId }),
    });
    ok(created.status === 503 && /not configured/i.test(created.data?.error || ''),
      `create order without keys → graceful 503 ("${created.data?.error}")`);
    console.log('\n  ────────────────────────────────────────────────────────────');
    console.log('  ℹ  Razorpay keys are NOT set — the live payment branch was skipped.');
    console.log('     To run the FULL pipeline, add TEST-MODE keys to server/.env:');
    console.log('       RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx');
    console.log('       RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx');
    console.log('     (Razorpay Dashboard → Test Mode → Settings → API Keys), restart');
    console.log('     the server, then re-run:  node server/test/day8.e2e.mjs');
    console.log('  ────────────────────────────────────────────────────────────');
    console.log(`\n${pass} passed, ${fail} failed  (not-configured branch)\n`);
    process.exit(fail ? 1 : 0);
  }

  // ── CONFIGURED branch: real Razorpay Test-Mode pipeline ─────────────────────
  ok(/^rzp_/.test(cfg.data?.keyId || ''), `public keyId looks like a Razorpay key (${cfg.data?.keyId})`);
  const secret = readEnv('RAZORPAY_KEY_SECRET');
  ok(!!secret, 'E2E can read the server Key Secret from server/.env (to simulate the signed callback)');

  // 1) Create order — send a BOGUS client amount; the server must ignore it and
  //    charge its OWN computed total.
  console.log('\n  ▶ POST /razorpay/order  (with a bogus client amount = 1 paise)');
  const created = await api('/api/payments/razorpay/order', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ items: client.cart, sessionId: client.sessionId, amount: 1, finalTotal: 1 }),
  });
  ok(created.status === 201 && created.data?.success, `order created (${created.status})`);
  ok(created.data?.amount === serverPaise,
    `amount is SERVER total ${serverPaise} paise, NOT the client's bogus 1 (got ${created.data?.amount})`);
  ok(created.data?.amount !== 1, 'client-supplied amount was ignored');
  ok(/^order_/.test(created.data?.razorpayOrderId || ''), `real Razorpay order id (${created.data?.razorpayOrderId})`);
  ok(created.data?.keyId === cfg.data?.keyId, 'returns the public keyId for Checkout');
  ok(created.data?.order?.payment?.status === 'created', 'persisted order is PENDING (payment.status=created), not paid');
  ok(String(created.data?.order?.userId) === String(userId), 'order is owned by the authenticated user');
  ok(anyLeaks([created.data?.order, created.data?.order?.payment]).length === 0
    && anyLeaks(created.data?.order?.items).length === 0,
    'created order carries no secret (and no razorpaySignature)');
  const razorpayOrderId = created.data?.razorpayOrderId;
  const localOrderId = created.data?.orderId;

  // 2) Simulate Razorpay's signed success callback (exactly what the browser POSTs
  //    back), then verify server-side.
  console.log('\n  ▶ POST /razorpay/verify  (valid signature computed with the server secret)');
  const paymentId = `pay_e2e_${Date.now()}`;
  const signature = expectedSignature(razorpayOrderId, paymentId, secret);
  const verify = await api('/api/payments/razorpay/verify', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
  });
  ok(verify.status === 200 && verify.data?.success, `verify succeeded (${verify.status})`);
  ok(verify.data?.order?.payment?.status === 'paid', 'order is now PAID (only after signature verification)');
  ok(verify.data?.order?.status === 'Confirmed', 'order status advanced to Confirmed');
  ok(verify.data?.order?.payment?.razorpayPaymentId === paymentId, 'razorpay payment id stored on the order');
  ok(verify.data?.order?.payment?.razorpayOrderId === razorpayOrderId, 'razorpay order id stored on the order');
  ok(!('razorpaySignature' in (verify.data?.order?.payment || {})), 'raw signature is NOT exposed to the client');

  // 3) Duplicate verify — idempotent no-op (req 6).
  console.log('\n  ▶ POST /razorpay/verify  again (duplicate)');
  const dup = await api('/api/payments/razorpay/verify', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
  });
  ok(dup.status === 200 && dup.data?.alreadyProcessed === true, 'duplicate verify → alreadyProcessed (no re-processing)');
  ok(dup.data?.order?.payment?.status === 'paid' && dup.data?.order?.finalTotal === verify.data?.order?.finalTotal,
    'duplicate leaves the paid order unchanged');

  // 4) Invalid signature on a FRESH order → 400, order stays UNPAID (reqs 5, 9).
  console.log('\n  ▶ invalid signature on a fresh order');
  const created2 = await api('/api/payments/razorpay/order', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ items: client.cart, sessionId: client.sessionId }),
  });
  const razorpayOrderId2 = created2.data?.razorpayOrderId;
  const localOrderId2 = created2.data?.orderId;
  const badVerify = await api('/api/payments/razorpay/verify', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ razorpay_order_id: razorpayOrderId2, razorpay_payment_id: 'pay_forged', razorpay_signature: 'deadbeefdeadbeef' }),
  });
  ok(badVerify.status === 400 && !badVerify.data?.success, `invalid signature rejected (${badVerify.status})`);
  const stillPending = await api(`/api/orders/${encodeURIComponent(localOrderId2)}`, { headers: authed() });
  ok(stillPending.data?.order?.payment?.status === 'created', 'order with a bad signature stays UNPAID (never marked paid)');

  // 5) Empty cart → 400 (req: failed/invalid input never creates a paid order).
  console.log('\n  ▶ create order with an empty cart');
  const emptyCart = await api('/api/payments/razorpay/order', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ items: [], sessionId: client.sessionId }),
  });
  ok(emptyCart.status === 400, `empty cart rejected (${emptyCart.status})`);

  // 6) Unavailable product → 400.
  console.log('\n  ▶ create order with an unavailable product');
  const badProduct = await api('/api/payments/razorpay/order', {
    method: 'POST', headers: authed(),
    body: JSON.stringify({ items: [{ productId: 999999999, quantity: 1 }], sessionId: client.sessionId }),
  });
  ok(badProduct.status === 400, `unavailable product rejected (${badProduct.status})`);

  // 7) My Orders — the PAID order shows; the abandoned pending one is hidden.
  console.log('\n  ▶ GET /api/orders (My Orders)');
  const mine = await api('/api/orders', { headers: authed() });
  const list = mine.data?.orders || [];
  const paidRow = list.find((o) => o.id === localOrderId);
  ok(!!paidRow && paidRow.payment?.status === 'paid', 'PAID order appears in My Orders');
  ok(!list.some((o) => o.id === localOrderId2), 'the unpaid/abandoned order is hidden from My Orders');
  ok(anyLeaks(list).length === 0, 'My Orders carries no secret');

  // 8) Order detail matches.
  console.log('\n  ▶ GET /api/orders/:id (Order detail)');
  const detail = await api(`/api/orders/${encodeURIComponent(localOrderId)}`, { headers: authed() });
  ok(detail.status === 200 && detail.data?.order?.payment?.status === 'paid', 'order detail shows PAID');
  ok(detail.data?.order?.payment?.razorpayPaymentId === paymentId, 'order detail exposes the useful Razorpay payment id');
  ok(Number(detail.data?.order?.finalTotal) === Number(summary.finalTotal), 'order total equals the server-authoritative total');

  console.log(`\n${pass} passed, ${fail} failed  (live Razorpay branch)\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nE2E ERROR:', e.message, '\n'); process.exit(1); });
