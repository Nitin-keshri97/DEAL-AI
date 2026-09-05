// ─────────────────────────────────────────────────────────────────────────
// server/test/day7.e2e.mjs — LIVE end-to-end for DAY 7 (real MongoDB + Gemini).
//
// NOT part of `test:server` (that stays offline/deterministic). Drives the full
// autonomous shopping + negotiation + accept + checkout flow over HTTP the way
// the browser client does: a client-side cart mirror updated ONLY from server
// cartActions, re-sending {message, cart, sessionId, history} each turn, with the
// Bearer token so cart/deal/checkout belong to the authenticated user.
//
// Mirrors the DAY 7 section-15 demo:
//   search → decide → add → analyze → suggest → add → best deal → accept → checkout
//
// Run:  node server/test/day7.e2e.mjs   (server must reach Mongo + Gemini)
// ─────────────────────────────────────────────────────────────────────────

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

let fallbackTurns = 0;
let liveTurns = 0;
async function chat(message) {
  const headers = { 'Content-Type': 'application/json' };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  const { data } = await api('/api/agent/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, cart: client.cart, sessionId: client.sessionId, history: [] }),
  });
  if (!data || !data.success) throw new Error('agent chat failed: ' + JSON.stringify(data));
  if (data.sessionId) client.sessionId = data.sessionId;
  if (data.usedFallback) fallbackTurns++; else liveTurns++;
  applyCartActions(data.cartActions);
  return data;
}

const SECRET_KEYS = ['costPrice', 'passwordHash', 'margin', 'floorPrice', 'floor'];
const leaks = (obj) => SECRET_KEYS.filter((k) => obj && Object.prototype.hasOwnProperty.call(obj, k));
const anyLeaks = (arr) => (arr || []).flatMap(leaks);

(async () => {
  console.log('\nDealAI DAY 7 — live autonomous shopping + negotiation flow (real MongoDB + Gemini)\n');
  console.log(`  base: ${BASE}\n`);

  // Catalogue + auth ──────────────────────────────────────────────────────────
  const prod = await api('/api/products');
  const products = prod.data?.products || [];
  const bySku = new Map(products.map((p) => [Number(p.sku), p]));
  ok(prod.status === 200 && products.length > 0, `catalogue loaded (${products.length} products)`);
  ok(anyLeaks(products).length === 0, 'no costPrice/secret in /api/products');

  const email = `day7_${Date.now()}@example.com`;
  const signup = await api('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Day Seven', email, password: 'secret123', confirmPassword: 'secret123' }),
  });
  ok(signup.status === 201 && signup.data?.token, `signup ok (${signup.status})`);
  client.token = signup.data?.token;

  // 1) "Mujhe 40000 ke andar best phone chahiye" ──────────────────────────────
  console.log('\n  ▶ "Mujhe 40000 ke andar best phone chahiye"');
  const r1 = await chat('Mujhe 40000 ke andar best phone chahiye');
  info(r1.message?.slice(0, 150));
  ok((r1.products || []).length > 0, `search returned ${r1.products?.length || 0} real product(s)`);
  ok((r1.products || []).every((p) => Number.isFinite(Number(p.sku)) && Number(p.price) > 0), 'every product has real sku + price');
  ok(anyLeaks(r1.products).length === 0, 'no costPrice/secret in search results');

  // 2) "Reviews check karo aur tum decide karo" ───────────────────────────────
  console.log('\n  ▶ "Reviews check karo aur tum decide karo"');
  const r2 = await chat('Reviews check karo aur tum decide karo');
  info(r2.message?.slice(0, 170));
  ok(!!r2.message, 'agent decided/answered');

  // 3) "Isko cart mein add karo" ──────────────────────────────────────────────
  console.log('\n  ▶ "Isko cart mein add karo"');
  let r3 = await chat('Isko cart mein add karo');
  info(r3.message?.slice(0, 150));
  if (!client.cart.length && (r3.pendingConfirmation || /which|kaun|colour|color|size|variant/i.test(r3.message || ''))) {
    r3 = await chat('Haan wahi, add kar do');
    info(r3.message?.slice(0, 150));
  }
  ok(client.cart.length > 0, `cart now has ${client.cart.length} real line(s): ${JSON.stringify(client.cart)}`);

  // 4) "Ab mera cart analyze karo" ────────────────────────────────────────────
  console.log('\n  ▶ "Ab mera cart analyze karo"');
  const r4 = await chat('Ab mera cart analyze karo');
  info(r4.message?.slice(0, 220));
  ok(!!r4.message, 'analyze responded about the real cart');
  ok(anyLeaks(r4.products).length === 0, 'no secret in suggested products');

  // 5) "Jo useful hai suggest karo" + 6) "Ye bhi add karo" ────────────────────
  console.log('\n  ▶ "Jo useful hai suggest karo"');
  const r5 = await chat('Jo useful hai suggest karo');
  info(r5.message?.slice(0, 200));
  console.log('  ▶ "Ye bhi add karo"');
  const beforeAdd = client.cart.reduce((n, l) => n + l.quantity, 0);
  const r6 = await chat('Ye bhi add karo');
  info(r6.message?.slice(0, 150));
  const afterAdd = client.cart.reduce((n, l) => n + l.quantity, 0);
  info(`cart units: ${beforeAdd} → ${afterAdd}; lines: ${JSON.stringify(client.cart)}`);
  ok(afterAdd > beforeAdd, 'a suggested product was actually added');

  // 7) "Ab best deal lao" → real bounded negotiation ──────────────────────────
  console.log('\n  ▶ "Ab best deal lao"');
  const r7 = await chat('Ab best deal lao');
  info(r7.message?.slice(0, 220));
  const neg = r7.negotiation;
  ok(!!neg && typeof neg.finalPrice === 'number', `negotiation ran: decision=${neg?.decision}, final=₹${neg?.finalPrice}`);
  ok(anyLeaks([neg]).length === 0, 'negotiation card carries no costPrice/margin/floor');
  if (neg) {
    ok(neg.finalPrice <= neg.originalPrice, `final ₹${neg.finalPrice} ≤ original ₹${neg.originalPrice} (bounded, never above)`);
    ok(neg.finalPrice > 0, 'final price is positive (never zero/negative)');
  }

  // 8) "Deal accept karo" → confirm + lock in, NO payment ─────────────────────
  console.log('\n  ▶ "Deal accept karo"');
  const r8 = await chat('Deal accept karo');
  info(r8.message?.slice(0, 220));
  ok(/accept|locked|lock|final|✓/i.test(r8.message || ''), 'agent confirmed acceptance');
  ok(!/paid|payment successful|charged\b(?!.*nothing)|order placed/i.test(r8.message || ''), 'accept never claims payment');

  // 9) "Checkout karo" → server-authoritative total incl. any valid deal ──────
  console.log('\n  ▶ "Checkout karo"');
  const r9 = await chat('Checkout karo');
  info(r9.message?.slice(0, 220));
  const co = r9.checkout;
  ok(r9.navigation?.type === 'checkout' || !!co, 'checkout handoff present');
  ok(!!co && Number(co.finalTotal) > 0, `server final total: ₹${co?.finalTotal} (subtotal ₹${co?.subtotal}, negotiated −₹${co?.negotiatedSavings || 0})`);
  ok(anyLeaks([co]).length === 0, 'checkout summary carries no secret');
  // Independent subtotal from PUBLIC prices proves the total is server-computed.
  const expected = client.cart.reduce((s, l) => s + (Number(bySku.get(l.productId)?.price) || 0) * l.quantity, 0);
  info(`independent subtotal from public prices: ₹${expected}`);
  ok(Number(co?.subtotal) === expected, 'server subtotal matches real catalogue prices × quantities');
  const claim = (r9.message || '').replace(/nothing is charged[^.]*\.?/gi, '');
  ok(!/\bpaid\b|payment successful|order placed|purchase complete/i.test(claim), 'never claims real payment / order placed');

  // 10) Failure handling — accept with a genuinely empty cart degrades
  //     gracefully (deterministic: empty the client mirror so the server sees an
  //     empty cart regardless of how the live model phrased "cart empty karo"). ─
  console.log('\n  ▶ (failure path) "deal accept karo" with an empty cart');
  await chat('cart empty karo');
  client.cart = []; // force-empty the mirror so the branch is deterministic
  const r10 = await chat('deal accept karo');
  info(r10.message?.slice(0, 180));
  ok(r10.success !== false, 'graceful response, no crash');
  ok(/empty|no deal|nothing to|add items|add a few|khaali|renegotiate/i.test(r10.message || ''), 'empty-cart accept explains there is no deal to apply (no false "accepted")');
  ok(!/locked in|deal accepted ✓/i.test(r10.message || ''), 'never falsely claims a locked-in deal on an empty cart');

  console.log(`\n  AI path: ${liveTurns} live Gemini turn(s), ${fallbackTurns} deterministic-fallback turn(s)`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nE2E ERROR:', e.message, '\n'); process.exit(1); });
