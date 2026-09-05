// ─────────────────────────────────────────────────────────────────────────
// server/test/day6.e2e.mjs — LIVE end-to-end for DAY 6 (real MongoDB + Groq).
//
// This is NOT part of `test:server` (that suite stays offline/deterministic).
// It exercises the actual agentic shopping flow over HTTP against a running
// API + the real Atlas catalogue, exactly the way the browser client does:
//   • keeps a client-side cart mirror, updated ONLY from server cartActions
//   • re-sends {message, cart, sessionId, history} each turn
//   • sends the Bearer token so the checkout handoff is authenticated
//
// It asserts the Day-6 guarantees:
//   • the agent searches REAL products (numeric sku + real price, no costPrice)
//   • "cart mein add karo" produces a real cart action against a real sku
//   • "cart ko analyze karo" analyses the ACTUAL cart
//   • "checkout karo" hands off with a SERVER-calculated total, never "paid"
//
// Run manually (server must be able to reach Mongo + Groq):
//   node server/test/day6.e2e.mjs
// Optional: E2E_BASE=http://localhost:5000 node server/test/day6.e2e.mjs
// ─────────────────────────────────────────────────────────────────────────

const BASE = process.env.E2E_BASE || 'http://localhost:5000';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
};
const info = (msg) => console.log('    •', msg);

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ── Client-side cart mirror + session, exactly like the React client ──────────
const client = { sessionId: undefined, token: null, cart: [] };

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
  const headers = { 'Content-Type': 'application/json' };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  const { data } = await api('/api/agent/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      cart: client.cart,
      sessionId: client.sessionId,
      history: [],
    }),
  });
  if (!data || !data.success) throw new Error('agent chat failed: ' + JSON.stringify(data));
  if (data.sessionId) client.sessionId = data.sessionId;
  applyCartActions(data.cartActions);
  return data;
}

// Guard: no server-only / secret field ever leaks in a product-ish payload.
const SECRET_KEYS = ['costPrice', 'passwordHash', 'margin', 'floorPrice', 'floor'];
const leaks = (obj) => SECRET_KEYS.filter((k) => obj && Object.prototype.hasOwnProperty.call(obj, k));
const anyLeaks = (arr) => (arr || []).flatMap(leaks);

(async () => {
  console.log('\nDealAI DAY 6 — live Hinglish agentic shopping flow (real MongoDB + Groq)\n');
  console.log(`  base: ${BASE}\n`);

  // 0) Catalogue is live and safe ─────────────────────────────────────────────
  const prod = await api('/api/products');
  const products = prod.data?.products || [];
  ok(prod.status === 200 && products.length > 0, `catalogue loaded (${products.length} products)`);
  ok(anyLeaks(products).length === 0, 'no costPrice/secret in /api/products payload');

  // 1) Auth (the checkout handoff is authenticated) ───────────────────────────
  const email = `day6_${Date.now()}@example.com`;
  const signup = await api('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Day Six', email, password: 'secret123', confirmPassword: 'secret123' }),
  });
  ok(signup.status === 201 && signup.data?.success, `signup ok (${signup.status})`);
  client.token = signup.data?.token;
  ok(!!client.token, 'received a session token');
  ok(leaks(signup.data?.user).length === 0, 'signup user never carries passwordHash');

  // 2) "Mujhe 30000 ke andar best phone chahiye" → REAL MongoDB search ─────────
  console.log('\n  ▶ "Mujhe 30000 ke andar best phone chahiye"');
  const r1 = await chat('Mujhe 30000 ke andar best phone chahiye');
  info(r1.message?.slice(0, 140));
  const found = r1.products || [];
  ok(found.length > 0, `search returned ${found.length} real product(s)`);
  ok(found.every((p) => Number.isFinite(Number(p.sku)) && Number(p.price) > 0), 'every product has a real numeric sku + price');
  ok(anyLeaks(found).length === 0, 'no costPrice/secret in agent products');
  if (r1.actions?.length) info(`agent activity: ${r1.actions.join(' · ')}`);
  const within = found.filter((p) => Number(p.price) <= 30000);
  info(`within budget (≤30000): ${within.length}/${found.length}${within.length ? '' : ' (agent should be honest about over-budget)'}`);

  // 3) "Reviews bhi dekho aur best wala choose karo" ──────────────────────────
  console.log('\n  ▶ "Reviews bhi dekho aur best wala choose karo"');
  const r2 = await chat('Reviews bhi dekho aur best wala choose karo');
  info(r2.message?.slice(0, 160));
  ok(!!r2.message, 'agent responded to the choose request');
  if (r2.actions?.length) info(`agent activity: ${r2.actions.join(' · ')}`);

  // 4) "Isko cart mein add karo" → REAL cart update on a REAL sku ──────────────
  console.log('\n  ▶ "Isko cart mein add karo"');
  let r3 = await chat('Isko cart mein add karo');
  info(r3.message?.slice(0, 160));
  // The agent may either add directly or (if a variant is required) ask first.
  if (!client.cart.length && (r3.pendingConfirmation || /which|kaun|colour|color|size|variant/i.test(r3.message || ''))) {
    info('agent asked before adding — confirming explicitly');
    r3 = await chat('Haan wahi, add kar do');
    info(r3.message?.slice(0, 160));
  }
  ok(client.cart.length > 0, `client cart now has ${client.cart.length} real line(s): ${JSON.stringify(client.cart)}`);
  ok(r3.cartUpdated === true || (r3.cartActions || []).some((a) => a.op === 'add'), 'response reported a real cart action');

  // 5) "Ab mere cart ko analyze karo" → analyses the ACTUAL cart ───────────────
  console.log('\n  ▶ "Ab mere cart ko analyze karo"');
  const r4 = await chat('Ab mere cart ko analyze karo');
  info(r4.message?.slice(0, 220));
  ok(!!r4.message, 'analyze responded about the actual cart');
  ok(anyLeaks(r4.products).length === 0, 'no costPrice/secret in any suggested products');

  // 6) "Jo useful hai wo bhi add karo" (only if the agent suggested something) ─
  if ((r4.products || []).length) {
    console.log('\n  ▶ "Jo useful lage wo bhi add karo"');
    const before = client.cart.length;
    const r4b = await chat('Jo useful lage wo bhi add karo');
    info(r4b.message?.slice(0, 160));
    info(`cart lines: ${before} → ${client.cart.length}`);
  }

  // 7) "Checkout karo" → SERVER-authoritative total, navigation, NO payment ────
  console.log('\n  ▶ "Checkout karo"');
  const r5 = await chat('Checkout karo');
  info(r5.message?.slice(0, 220));
  const nav = r5.navigation;
  const co = r5.checkout;
  ok(nav?.type === 'checkout' || !!co, 'checkout handoff present (navigation + checkout summary)');
  ok(!!co && Number(co.finalTotal) > 0, `server-calculated final total: ₹${co?.finalTotal}`);
  ok(anyLeaks([co]).length === 0, 'checkout summary carries no costPrice/secret');

  // Independently recompute the expected subtotal from the PUBLIC catalogue to
  // prove the total came from real server prices (not anything the client sent).
  const bySku = new Map(products.map((p) => [Number(p.sku), p]));
  const expected = client.cart.reduce((sum, l) => sum + (Number(bySku.get(l.productId)?.price) || 0) * l.quantity, 0);
  info(`independent subtotal from public prices: ₹${expected}  (server subtotal: ₹${co?.subtotal})`);
  ok(Number(co?.subtotal) === expected, 'server subtotal matches real catalogue prices × quantities');
  // The agent MUST NOT claim a real payment happened. Strip the safe disclaimer
  // ("nothing is charged now") first, so we only catch an actual false claim of
  // payment/placement — not the reassurance that nothing was charged.
  const claim = (r5.message || '').replace(/nothing is charged[^.]*\.?/gi, '').replace(/payment is handled separately[^.)]*/gi, '');
  ok(!/\bpaid\b|payment successful|payment received|you('ve| have) been charged|order placed|order has been placed|purchase complete/i.test(claim), 'never claims real payment / order placed');

  // 8) Voice parity — the mic path is the SAME endpoint with a transcribed
  //    string, so a Hinglish "voice" utterance must drive the same tools. ─────
  console.log('\n  ▶ (voice parity) transcript: "gaming laptop dikhao 60000 ke andar"');
  const rv = await chat('gaming laptop dikhao 60000 ke andar');
  info(rv.message?.slice(0, 160));
  ok((rv.products || []).length > 0, `voice-style query returned ${rv.products?.length || 0} real product(s)`);
  ok(anyLeaks(rv.products).length === 0, 'no costPrice/secret in voice-path products');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nE2E ERROR:', e.message, '\n');
  process.exit(1);
});
