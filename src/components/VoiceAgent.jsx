import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Square, Loader2, Volume2, AlertCircle, Check, ShoppingCart } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useUI } from '../context/UIContext';
import { products as CATALOGUE } from '../data/products';
import { sendAgentMessage, streamAgentMessage } from '../lib/api';
import { getAgentSessionId } from '../lib/session';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useAgentActivity } from '../context/AgentActivityContext';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

// ─────────────────────────────────────────────────────────────────────────
// VoiceAgent — the ONE floating voice experience for DealAI.
//
// Clicking the bottom-center button does NOT open any modal/chatbot/drawer —
// the shopping page stays visible. A lightweight on-screen HUD shows the user's
// transcript, DealAI's spoken reply (as text), the LIVE activity (real tool
// steps), and real product results. While DealAI works, the page gets a subtle
// "working" ambient state (soft dim + gentle glow), removed when it finishes.
//
// Everything reuses the existing pieces — no new backend, no separate session:
//   speech-in  useSpeechRecognition · pipeline sendAgentMessage(/api/agent/chat)
//   cart       server-validated res.cartActions via CartContext
//   speech-out browser speechSynthesis of the SANITIZED natural reply only
// ─────────────────────────────────────────────────────────────────────────

// Strip Markdown / emoji / symbols so TTS speaks only clean conversational text.
function sanitizeForSpeech(md) {
  let t = String(md || '');
  t = t.replace(/```[\s\S]*?```/g, ' ');          // fenced code
  t = t.replace(/`([^`]*)`/g, '$1');               // inline code
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');      // images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');    // links → link text
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');          // bold
  t = t.replace(/\*([^*]+)\*/g, '$1');              // italic
  t = t.replace(/^#{1,6}\s+/gm, '');                // headings
  t = t.replace(/^\s*[-*•]\s+/gm, '');              // bullet markers
  t = t.replace(/[*_>#~|]/g, ' ');                  // stray md punctuation
  // emojis + pictographs + dingbats + arrows (variation selectors / ZWJ handled separately)
  t = t.replace(/[\u{FE0F}\u{200D}]/gu, '');
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '');
  t = t.replace(/₹\s*/g, 'Rupees ');                // currency symbol → word
  t = t.replace(/(\d),(?=\d{3}\b)/g, '$1');         // 1,999 → 1999 (natural)
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

// Keep the spoken reply short & natural — first couple of sentences.
function shortenForSpeech(t) {
  if (t.length <= 240) return t;
  const parts = t.split(/(?<=[.!?।])\s+/);
  let out = '';
  for (const p of parts) {
    if ((out + ' ' + p).trim().length > 240) break;
    out = (out ? out + ' ' : '') + p;
  }
  return out || t.slice(0, 240);
}

// ── Build a SHORT conversational line to SPEAK (never the full res.message) ──
// Fully deterministic, no extra AI/Gemini call. We first try to lift the AI's
// own conversational sentence/question out of the response (dropping product
// spec lists, bullets, prices, markdown), and otherwise synthesize a natural
// 1–2 sentence summary from the real response data (added item, negotiation,
// top product, pending proposal, or activity). The full text still shows on
// screen unchanged — only speech is trimmed.

// Spec/detail "Key: value" lines we never want to speak.
const SPEC_KEY = /^\s*(ratings?|price|mrp|cost|reviews?|review count|features?|specs?|specifications?|brand|category|stock|availability|in ?stock|colou?rs?|sizes?|variants?|ram|rom|storage|memory|battery|display|screen|camera|processor|chip|warranty|weight|material|dimensions?|model|sku|discount|savings?|total|subtotal|quantity|qty)\s*[:\-–—]/i;

function isDataLine(raw) {
  const l = String(raw || '').trim();
  if (!l) return true;
  if (/^[-*•·▪◦‣]\s+/.test(l)) return true;            // bullet
  if (/^\d+[.)]\s+/.test(l)) return true;               // numbered list
  if (/^#{1,6}\s+/.test(l)) return true;                // heading
  if (/^>\s+/.test(l)) return true;                     // blockquote
  if (/^\|.*\|$/.test(l)) return true;                  // table row
  if (SPEC_KEY.test(l)) return true;                    // "Rating: 4.6"
  if (/^\*\*[^*]+\*\*\s*[:\-–—]/.test(l)) return true;   // "**Name**: …"
  // short "name ₹price" style product header (no sentence punctuation)
  if (/₹\s?\d/.test(l) && l.length <= 60 && !/[.?!।]$/.test(l)) return true;
  return false;
}

// Strip inline markdown/emoji for a clean prose string (prices handled later).
function sanitizeInline(text) {
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/[*_>#~|]/g, ' ');
  t = t.replace(/[\u{FE0F}\u{200D}]/gu, '');
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pull the AI's own conversational sentence(s) — prose only, ≤2 sentences,
// preferring a trailing question. Returns '' when the reply is mainly data.
function extractConversational(message) {
  const prose = String(message || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !isDataLine(l))
    .map(sanitizeInline)
    .filter(Boolean);
  if (!prose.length) return '';
  const sentences = splitSentences(prose.join(' '))
    .filter((s) => !/[:：]$/.test(s))                                   // list introducers
    .filter((s) => !/^(yeh|ye|yahan|here|below|niche|neeche)\b/i.test(s))
    .filter((s) => /[a-zA-Zऀ-ॿ]/.test(s));                    // must have words
  if (!sentences.length) return '';
  const question = sentences.find((s) => /[?？]$/.test(s));
  let picked = (question && question !== sentences[0])
    ? `${sentences[0]} ${question}`
    : sentences.slice(0, 2).join(' ');
  if (picked.length > 240) picked = sentences[0].slice(0, 240);
  return picked.trim();
}

// Choose the single short line DealAI will actually speak.
function buildSpokenResponse(res, added = []) {
  const conv = extractConversational(res?.message);
  const convMentionsAdd = /(add|cart|daal|dal|kar diya|kar diye|add kar)/i.test(conv);

  // 1) A cart add really happened → speak a clean confirmation (unless the AI
  //    already said so in its own prose, which we then prefer).
  if (added.length > 0 && !convMentionsAdd) {
    if (added.length === 1) return `Done! Maine ${added[0].name} aapke cart mein add kar diya hai.`;
    return `Done! Maine ${added.length} items aapke cart mein add kar diye hain.`;
  }

  // 2) Prefer the AI's own conversational sentence / question.
  if (conv) return conv;

  // 3) A proposal is awaiting the user's yes → a natural question.
  if (res?.pendingConfirmation?.name) {
    const n = res.pendingConfirmation;
    const price = Number(n.price) > 0 ? ` Price Rupees ${Math.round(n.price)} hai.` : '';
    return `Mujhe ${n.name} best option lag raha hai.${price} Kya main ise cart mein add kar doon?`;
  }

  // 4) Negotiation result → preserve the final price.
  if (Number(res?.negotiation?.finalPrice) > 0) {
    return `Maine aapke liye best deal nikaali hai — final price Rupees ${Math.round(res.negotiation.finalPrice)} hai.`;
  }

  // 5) Product results → short summary naming the top pick (+ rating if known).
  const top = (res?.products || [])[0];
  if (top?.name) {
    const rating = Number(top.rating) > 0 ? ` Rating ${top.rating} hai.` : '';
    const comparing = (res?.actions || []).some((a) => /compar/i.test(a));
    return comparing
      ? `Mujhe kuch strong options mile hain. Mujhe ${top.name} best value lag raha hai.${rating}`
      : `Mujhe ${top.name} best option lag raha hai.${rating}`;
  }

  // 6) Only activity (e.g. searching / comparing), no products yet.
  const acts = res?.actions || [];
  if (acts.some((a) => /search|catalog/i.test(a))) return 'Sure, main aapke liye best options check kar raha hoon.';
  if (acts.some((a) => /compar/i.test(a))) return 'Mujhe kuch strong options mile hain. Main unmein se best value choose kar raha hoon.';

  // 6b) A navigation action (checkout / orders / order) that carried no
  //     conversational prose of its own → a short, natural confirmation. The
  //     REAL routing is executed separately from the backend's `navigation`
  //     object; this only decides what DealAI SAYS. No price/total is invented
  //     here — the server stays authoritative for every amount.
  const navType = res?.navigation?.type;
  if (navType === 'checkout') {
    return res?.navigation?.requiresAuth
      ? 'Checkout ke liye pehle login karna hoga — main login khol raha hoon.'
      : 'Theek hai! Main aapko checkout par le ja raha hoon.';
  }
  if (navType === 'orders') return 'Theek hai, main aapke orders khol raha hoon.';
  if (navType === 'order') return 'Zaroor, main aapka order khol raha hoon.';

  // 7) Last resort — the first clean sentence only (never the whole message).
  return splitSentences(sanitizeInline(res?.message))[0] || 'Ho gaya.';
}

// Detect Hindi/Hinglish so we can prefer a hi-IN voice.
const HINGLISH_HINTS = /\b(hoon|hai|hain|kar|karo|kardo|kardo|dekh|dekho|raha|rahe|rahi|aap|aapke|aapko|liye|achha|achhe|acha|ache|mein|mera|meri|kya|nahi|haan|haa|diya|diye|kiya|krdo|chahiye|batao|dikhao|lagao|jodo|hata|hatao|wala|wali|abhi|thoda|zyada|kam|sasta|mehnga|paisa|rupaye|rupee)\b/i;
function isHindiish(text) {
  if (/[ऀ-ॿ]/.test(text)) return true; // Devanagari
  return HINGLISH_HINTS.test(text);
}

function pickVoice(voices, hindi) {
  if (!voices || voices.length === 0) return null;
  const order = hindi ? ['hi-in', 'hi'] : ['en-in', 'en-gb', 'en-us', 'en'];
  for (const pref of order) {
    const v = voices.find((x) => (x.lang || '').toLowerCase().startsWith(pref));
    if (v) return v;
  }
  // graceful fallback: any English, else the first available voice
  return voices.find((x) => (x.lang || '').toLowerCase().startsWith('en')) || voices[0] || null;
}

// Clean an activity label for on-screen display (drop the leading emoji).
function cleanStep(s) {
  return String(s || '')
    .replace(/^[\s\u{FE0F}]+/u, '')
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u, '')
    .replace(/^[\s\u{FE0F}]+/u, '')
    .trim();
}

// Present-tense, in-progress phrasing keyed off the REAL backend tool name
// (event.tool). Used for the live `tool_start` moment so the HUD reads
// "Searching products…" while the tool runs; the server's past-tense label
// ("Searched the catalogue") is used on tool_complete. This is NOT a predefined
// checklist — nothing shows unless the backend actually starts that tool.
const LIVE_TOOL_LABELS = {
  analyze: 'Analyzing your request…',
  searchProducts: 'Searching products…',
  getProductDetails: 'Checking product details…',
  getProductReviews: 'Analyzing reviews…',
  getRelatedProducts: 'Finding related products…',
  recommendProducts: 'Comparing the best options…',
  getPersonalizedRecommendations: 'Personalizing recommendations…',
  compareProducts: 'Comparing products…',
  addToCart: 'Adding to cart…',
  removeFromCart: 'Removing from cart…',
  updateCartQuantity: 'Updating quantity…',
  clearCart: 'Clearing cart…',
  proposeCartChange: 'Preparing a suggestion…',
  analyzeCart: 'Analyzing your cart…',
  analyzeCartForBundle: 'Checking bundle savings…',
  findBundleOpportunities: 'Checking bundle savings…',
  startNegotiation: 'Negotiating the best price…',
  acceptDeal: 'Locking in the deal…',
  prepareCheckout: 'Preparing checkout…',
  proceedToCheckout: 'Proceeding to checkout…',
  selectProductVariant: 'Checking options…',
  getMyOrders: 'Looking up your orders…',
  getOrderDetails: 'Looking up order details…',
};

export default function VoiceAgent() {
  const { cartItems, subtotal, addToCart, removeFromCart, setQuantity, clearCart } = useCart();
  const { setActivity } = useAgentActivity();
  const { navigate, openAuth } = useUI();

  const [phase, setPhase] = useState('idle'); // idle | listening | processing | speaking | error
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [steps, setSteps] = useState([]);   // real, completed tool steps
  const [revealed, setRevealed] = useState(0); // how many steps are shown (live reveal)
  const [products, setProducts] = useState([]);
  const [added, setAdded] = useState([]);   // items the server actually added this turn
  const [errorMsg, setErrorMsg] = useState('');

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const sessionIdRef = useRef(getAgentSessionId());
  const speakingSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const cartRef = useRef(cartItems);
  cartRef.current = cartItems;

  // Timers we may need to clear (progressive reveal + HUD auto-hide).
  const revealTimers = useRef([]);
  const hideTimer = useRef(null);
  const clearRevealTimers = () => { revealTimers.current.forEach(clearTimeout); revealTimers.current = []; };

  // Cache the browser voice list (populated async on some browsers).
  const voicesRef = useRef([]);
  useEffect(() => {
    if (!speakingSupported) return undefined;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, [speakingSupported]);

  // Resolve a full cart line for an `add` action WITHOUT depending on the local
  // static catalogue being complete. The backend catalogue (MongoDB) has more
  // products (e.g. sku 23 "Nova Pro 5G") than src/data/products.js, so a plain
  // CATALOGUE.find() returns undefined for those and the add was silently
  // dropped. We layer three server-authoritative sources instead:
  //   1. the action itself — { productId, name, price } (trusted catalogue price)
  //   2. this turn's `products` results (compactCard: sku,name,category,price,originalPrice…)
  //   3. the local static file — only for extra display fields like `image`
  // We NEVER invent a price: `price` comes from the action (the server's trusted
  // value); originalPrice falls back to price so savings math never becomes NaN.
  const resolveAddLine = useCallback((a, serverProducts = []) => {
    const id = Number(a.productId);
    const local = CATALOGUE.find((p) => p.id === id);
    const remote = serverProducts.find((p) => Number(p.sku) === id);
    const price = a.price ?? remote?.price ?? local?.price ?? 0;
    return {
      id,
      name: a.name || remote?.name || local?.name || 'Item',
      price,
      originalPrice: remote?.originalPrice ?? local?.originalPrice ?? price,
      category: remote?.category || local?.category || '',
      brand: remote?.brand || local?.brand || '',
      image: local?.image || remote?.image || '',
    };
  }, []);

  const applyCartActions = useCallback(
    (actions = [], serverProducts = []) => {
      for (const a of actions) {
        const id = Number(a.productId);
        // TEMP debug (DEV only — stripped from production build).
        if (import.meta.env.DEV) {
          console.log('[Agent] ACTION:', a.op, a);
          console.log('[Agent] PRODUCT ID:', id);
          console.log('[Agent] CART BEFORE:', cartRef.current.map((i) => ({ id: i.id, q: i.quantity })));
        }
        if (a.op === 'clear') clearCart();
        else if (a.op === 'add') {
          addToCart(resolveAddLine(a, serverProducts), a.quantity || 1, a.variant || null);
        } else if (a.op === 'remove') removeFromCart(id);
        else if (a.op === 'update') setQuantity(id, a.quantity);
      }
    },
    [addToCart, removeFromCart, setQuantity, clearCart, resolveAddLine]
  );

  // TEMP debug (DEV only): confirm the cart state actually changed after apply.
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Agent] CART AFTER:', cartItems.map((i) => ({ id: i.id, q: i.quantity })));
    }
  }, [cartItems]);

  // Execute a REAL navigation the backend has ALREADY authorized. Every agent
  // response carries the existing `navigation` contract (the same object the
  // text chat's handleNav consumes): { type:'checkout'|'orders'|'order',
  // requiresAuth?, param? }. It is present ONLY when the server confirmed the
  // action can proceed — e.g. proceedToCheckout sets it after validating a
  // non-empty cart and computing the server-side total, and OMITS it for an
  // empty cart. So the frontend never decides IF checkout may happen, never
  // invents a price/total, and never builds a fake page — it only ROUTES to the
  // existing view. No setTimeout: routing fires immediately from the real
  // result, never on an arbitrary delay.
  const handleAgentNavigation = useCallback(
    (nav) => {
      if (!nav || !nav.type) return;
      // A guest checkout is flagged requiresAuth by the server → use the
      // existing login flow (mirrors AgentPanel: protected routes prompt login).
      if (nav.requiresAuth) { openAuth('login'); return; }
      if (nav.type === 'checkout') navigate('checkout');
      else if (nav.type === 'orders') navigate('orders');
      else if (nav.type === 'order') navigate('order', nav.param);
    },
    [navigate, openAuth]
  );

  const stopSpeaking = useCallback(() => {
    if (speakingSupported) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  }, [speakingSupported]);

  const speak = useCallback(
    (rawText) => {
      const clean = shortenForSpeech(sanitizeForSpeech(rawText));
      if (!speakingSupported || !clean) { setPhase('idle'); return; }
      try {
        window.speechSynthesis.cancel(); // never overlap
        const hindi = isHindiish(clean);
        const voice = pickVoice(voicesRef.current, hindi);
        const u = new SpeechSynthesisUtterance(clean);
        if (voice) u.voice = voice;
        u.lang = voice?.lang || (hindi ? 'hi-IN' : 'en-IN');
        u.rate = hindi ? 0.96 : 1;   // slightly slower Hindi reads more naturally
        u.pitch = 1;
        u.onend = () => setPhase((p) => (p === 'speaking' ? 'idle' : p));
        u.onerror = () => setPhase((p) => (p === 'speaking' ? 'idle' : p));
        setPhase('speaking');
        window.speechSynthesis.speak(u);
      } catch {
        setPhase('idle');
      }
    },
    [speakingSupported]
  );

  const abortControllerRef = useRef(null);

  const runRequest = useCallback(
    async (rawText) => {
      const text = String(rawText || '').trim();
      if (!text) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      stopSpeaking();
      clearRevealTimers();
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      setHeard(text);
      setReply('');
      setProducts([]);
      setAdded([]);
      setSteps([]);
      setRevealed(0);
      setErrorMsg('');
      setPhase('processing');

      const cart = cartRef.current.map((i) => ({ productId: i.id, quantity: i.quantity }));

      const reqT0 = performance.now();
      if (import.meta.env.DEV) console.log('[STREAM][+0ms] REQUEST_SENT');

      try {
        let streamWorked = false;
        await streamAgentMessage({
          message: text,
          cart,
          sessionId: sessionIdRef.current,
          history: [],
          signal: controller.signal,
          onEvent: (event) => {
            if (controller.signal.aborted) return;
            streamWorked = true;

            // TEMP boundary trace (DEV only — stripped from prod build). Shows
            // that each event arrives progressively, not batched at the end.
            if (import.meta.env.DEV) {
              const t = Math.round(performance.now() - reqT0);
              const tag = { start: 'START_EVENT', tool_start: 'TOOL_START', tool_complete: 'TOOL_COMPLETE', text_delta: 'TEXT_DELTA', complete: 'COMPLETE' }[event.type];
              if (tag) console.log(`[STREAM][+${t}ms] ${tag}`, event.tool || event.label || (event.text ? `"${event.text.slice(0, 24)}…"` : ''));
            }

            if (event.type === 'start') {
              setPhase('processing');
            } else if (event.type === 'tool_start') {
              // In-progress phrasing from the REAL tool name; fall back to the
              // server label. Shown live the instant the tool begins.
              const live = LIVE_TOOL_LABELS[event.tool] || cleanStep(event.label) || 'Working…';
              setSteps((prev) => {
                const next = prev.includes(live) ? prev : [...prev, live];
                setRevealed(next.length);
                return next;
              });
            } else if (event.type === 'tool_complete') {
              // Transition THIS tool's in-progress line to the server's
              // completed (past-tense) label, in place — no duplicate row.
              const live = LIVE_TOOL_LABELS[event.tool];
              const done = cleanStep(event.label);
              if (done) {
                setSteps((prev) => {
                  const idx = live ? prev.lastIndexOf(live) : -1;
                  let next;
                  if (idx >= 0) { next = [...prev]; next[idx] = done; }
                  else next = prev.includes(done) ? prev : [...prev, done];
                  setRevealed(next.length);
                  return next;
                });
              }
            } else if (event.type === 'text_delta') {
              if (event.text) {
                setReply((prev) => (prev ? prev + ' ' + event.text : event.text));
              }
            } else if (event.type === 'complete') {
              if (import.meta.env.DEV) {
                console.log('[Agent] COMPLETE EVENT:', event);
                console.log('[Agent] CART ACTIONS:', event.cartActions);
              }
              if (event.sessionId) sessionIdRef.current = event.sessionId;
              if (event.cartActions?.length) applyCartActions(event.cartActions, event.products || []);

              const addedItems = (event.cartActions || [])
                .filter((a) => a.op === 'add')
                .map((a) => resolveAddLine(a, event.products || []))
                .map((p) => ({ id: p.id, name: p.name, price: p.price }));
              setAdded(addedItems);
              setProducts(event.products || []);
              if (event.message) setReply(event.message);

              const realSteps = (event.actions || []).map(cleanStep).filter(Boolean);
              if (realSteps.length > 0) {
                setSteps(realSteps);
                setRevealed(realSteps.length);
              }

              const spoken = buildSpokenResponse(event, addedItems);
              speak(spoken);

              // Then IMMEDIATELY execute any real navigation the server
              // authorized (checkout / orders / order). Driven by the actual
              // `complete` result — never a timer, never because the text said
              // "checkout". Empty cart / not-yet-ready → server omits navigation
              // → this is a no-op and the spoken message explains why.
              handleAgentNavigation(event.navigation);
            }
          },
        });
        if (!streamWorked) {
          throw new Error('Stream returned no events');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('[DealAI][VoiceAgent] Stream failed → falling back to /api/agent/chat:', err.message);

        try {
          const res = await sendAgentMessage({ message: text, cart, sessionId: sessionIdRef.current, history: [] });
          if (controller.signal.aborted) return;

          if (import.meta.env.DEV) {
            console.log('[Agent] COMPLETE EVENT:', res);
            console.log('[Agent] CART ACTIONS:', res.cartActions);
          }
          if (res.sessionId) sessionIdRef.current = res.sessionId;
          if (res.cartActions?.length) applyCartActions(res.cartActions, res.products || []);

          // Real, server-authorized navigation — run it NOW, not inside the
          // cosmetic step-reveal timers below, so it's driven by the result and
          // never by an arbitrary delay.
          handleAgentNavigation(res.navigation);

          const addedItems = (res.cartActions || [])
            .filter((a) => a.op === 'add')
            .map((a) => resolveAddLine(a, res.products || []))
            .map((p) => ({ id: p.id, name: p.name, price: p.price }));
          setAdded(addedItems);
          setProducts(res.products || []);

          // The fallback endpoint (/api/agent/chat) is NOT a stream — it returns
          // one final payload. Render its real steps immediately; we must NOT
          // fake progressive streaming with staggered setTimeouts (that is what
          // made a fallback look like — and get mistaken for — real streaming).
          const realSteps = (res.actions || []).map(cleanStep).filter(Boolean);
          setSteps(realSteps);
          setRevealed(realSteps.length);

          const spoken = buildSpokenResponse(res, addedItems);
          setReply(res.message || 'Done.');
          speak(spoken);
        } catch (fe) {
          if (controller.signal.aborted) return;
          setErrorMsg('Sorry, I could not process that right now. Please try again.');
          setReply('');
          setPhase('error');
          stopSpeaking();
        }
      }
    },
    [applyCartActions, resolveAddLine, speak, stopSpeaking, handleAgentNavigation]
  );

  const voice = useSpeechRecognition({ lang: 'en-IN', onResult: (t) => runRequest(t) });

  useEffect(() => {
    if (voice.listening) setPhase('listening');
    else if (phase === 'listening') setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.listening]);

  useEffect(() => {
    if (!voice.error) return;
    if (voice.error === 'no-speech') { setPhase('idle'); return; }
    setErrorMsg(
      voice.error === 'not-allowed'
        ? 'Mic access is blocked. Enable it in your browser, or use the chat instead.'
        : 'Voice input hit a snag. Please try again, or use the chat.'
    );
    setPhase('error');
  }, [voice.error]);

  // Publish the LIVE agent state to the shared mirror so other UI (the Hero's
  // activity card) can reflect REAL activity. Purely additive — it mirrors
  // state already derived from real speech + stream events; never drives work.
  useEffect(() => {
    setActivity({ phase, steps });
  }, [phase, steps, setActivity]);

  // Auto-hide the HUD a few seconds after DealAI stops speaking (keeps the
  // screen clean; the page was never blocked).
  useEffect(() => {
    if (phase !== 'idle') return undefined;
    if (!(heard || reply || steps.length || errorMsg)) return undefined;
    hideTimer.current = setTimeout(() => {
      setHeard(''); setReply(''); setSteps([]); setRevealed(0); setProducts([]); setAdded([]); setErrorMsg('');
    }, 6000);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [phase, heard, reply, steps.length, errorMsg]);

  useEffect(() => () => { stopSpeaking(); clearRevealTimers(); if (hideTimer.current) clearTimeout(hideTimer.current); }, [stopSpeaking]);

  const onMicClick = useCallback(() => {
    if (!voice.supported) {
      setErrorMsg("Voice input isn't available in this browser. You can use the chat instead.");
      setPhase('error');
      return;
    }
    if (voice.listening) { voice.stop(); return; }
    stopSpeaking();            // interrupt any current speech on a new request
    clearRevealTimers();
    if (phase === 'error') { setErrorMsg(''); setPhase('idle'); }
    voice.reset();
    voice.start();
  }, [voice, phase, stopSpeaking]);

  const busy = phase === 'processing';
  const listening = phase === 'listening';
  const speaking = phase === 'speaking';
  const working = busy || speaking; // page shows the subtle ambient state
  const active = listening || busy || speaking;
  const idle = phase === 'idle'; // resting state → gentle "breathing" glow

  const label =
    listening ? 'Listening…'
    : busy ? 'DealAI is thinking…'
    : speaking ? 'DealAI is speaking…'
    : phase === 'error' ? 'Tap to try again'
    : 'Talk to DealAI';

  const btnClass =
    listening ? 'bg-accent text-white hover:bg-accent-ink'
    : busy ? 'bg-ink text-white'
    : speaking ? 'bg-accent text-white'
    : phase === 'error' ? 'bg-amber-500 text-white hover:bg-amber-600'
    : 'bg-ink text-white hover:bg-ink-soft hover:scale-105';

  const hasHud = Boolean(heard || reply || errorMsg || busy || listening || steps.length);
  const cartTotal = subtotal;

  return (
    <>
      <style>{`
        @keyframes va-ambient { 0%,100%{opacity:.4} 50%{opacity:.7} }
        @keyframes va-rise { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .va-rise{animation:va-rise .28s ease-out both}
        @keyframes va-breathe { 0%,100%{transform:scale(1);opacity:.32} 50%{transform:scale(1.12);opacity:.55} }
        .va-breathe{animation:va-breathe 3.4s ease-in-out infinite}
        @keyframes va-ripple { 0%{transform:scale(.9);opacity:.45} 100%{transform:scale(1.9);opacity:0} }
        .va-ripple{animation:va-ripple 1.9s ease-out infinite}
      `}</style>

      {/* Subtle "DealAI is working" ambient state over the shopping page.
          pointer-events-none → the page stays fully usable. */}
      <div
        aria-hidden
        className={`fixed inset-0 z-30 pointer-events-none transition-opacity duration-500 ${working ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className={`absolute inset-0 bg-ink/[0.03] ${reduceMotion ? '' : 'backdrop-blur-[1.5px]'}`} />
        <div
          className="absolute inset-0"
          style={{
            boxShadow: 'inset 0 0 140px 30px rgba(90,80,220,0.15)',
            animation: reduceMotion ? 'none' : 'va-ambient 3s ease-in-out infinite',
          }}
        />
      </div>

      {/* Floating voice HUD + button — bottom-center, NOT a modal/chatbot. */}
      <div className="fixed inset-x-0 bottom-5 z-40 flex flex-col items-center gap-2.5 px-4 pointer-events-none">
        {hasHud && (
          <div className="w-full max-w-sm flex flex-col items-stretch gap-2">
            {/* User transcript */}
            {heard && (
              <div className="va-rise self-end max-w-[90%]">
                <span className="inline-block bg-ink/90 text-white text-xs rounded-2xl rounded-br-sm px-3 py-1.5 shadow-lg backdrop-blur">
                  {heard}
                </span>
              </div>
            )}

            {/* Live listening feedback */}
            {listening && (
              <div className="va-rise self-center text-[11px] font-semibold text-accent-ink glass rounded-full px-3 py-1.5 shadow flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  {!reduceMotion && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60 opacity-75" />}
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
                </span>
                {voice.interim || 'Listening… (Hinglish is fine)'}
              </div>
            )}

            {/* Live activity — only REAL, completed steps, revealed one by one */}
            {(busy || revealed > 0) && (
              <div className="va-rise self-start w-full glass rounded-xl shadow px-3 py-2">
                {busy && revealed === 0 && (
                  <p className="text-[11px] text-muted flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Understanding your request…
                  </p>
                )}
                <ul className="space-y-1">
                  {steps.slice(0, revealed).map((s, i) => (
                    <li key={i} className="va-rise flex items-center gap-1.5 text-[11px] text-ink-soft">
                      <Check className="w-3 h-3 text-accent shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* DealAI's spoken reply, shown as text */}
            {reply && (
              <div className="va-rise self-start max-w-[92%]">
                <span className="inline-block bg-paper text-ink-soft text-xs rounded-2xl rounded-bl-sm px-3 py-2 shadow-lg border border-line whitespace-pre-wrap">
                  {reply}
                </span>
              </div>
            )}

            {/* Items the server actually added this turn */}
            {added.length > 0 && (
              <div className="va-rise self-start w-full bg-paper rounded-xl shadow border border-line px-3 py-2.5 space-y-1.5">
                {added.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="font-bold text-ink truncate">{p.name}</span>
                    </span>
                    <span className="font-extrabold text-ink shrink-0">₹{inr(p.price)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 border-t border-line text-xs">
                  <span className="text-muted font-semibold">Cart Total</span>
                  <span className="font-extrabold text-accent">₹{inr(cartTotal)}</span>
                </div>
              </div>
            )}

            {/* Real product results (when no explicit add happened) */}
            {added.length === 0 && products.length > 0 && (
              <div className="va-rise self-start w-full space-y-1.5">
                {products.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-paper p-2 shadow-sm">
                    {p.image && <img src={p.image} alt="" className="w-9 h-9 rounded-lg object-cover bg-canvas border border-line" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink truncate">{p.name}</p>
                      <p className="text-[11px] text-muted">₹{inr(p.price)}</p>
                    </div>
                    <ShoppingCart className="w-3.5 h-3.5 text-faint shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Error with clear retry (tap the button again) */}
            {errorMsg && (
              <div className="va-rise self-center w-full rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-700 flex items-start gap-1.5 shadow">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* State label — a small floating pill above the mic (not a modal) */}
        <span
          className={`va-rise pointer-events-none inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm transition-colors ${
            active ? 'bg-ink text-white' : 'glass text-ink'
          }`}
        >
          {label}
        </span>

        {/* The one floating voice button — a single circular mic, bottom-center */}
        <button
          type="button"
          onClick={onMicClick}
          aria-label={label}
          aria-pressed={listening}
          className={`pointer-events-auto relative flex items-center justify-center w-16 h-16 rounded-full shadow-xl transition-all active:scale-95 ${btnClass}`}
        >
          {/* Soft outer glow — the AI's "presence": gentle breathing at rest,
              brighter while it's live. Purely decorative. */}
          {!reduceMotion && (
            <span
              aria-hidden
              className={`absolute rounded-full blur-md ${active ? '-inset-3 bg-accent/40' : '-inset-2 bg-accent/25'} ${idle ? 'va-breathe' : ''}`}
            />
          )}

          {/* Listening → concentric ripples radiating outward */}
          {listening && !reduceMotion && (
            <>
              <span aria-hidden className="absolute inset-0 rounded-full bg-accent/30 va-ripple" />
              <span aria-hidden className="absolute inset-0 rounded-full bg-accent/30 va-ripple" style={{ animationDelay: '0.7s' }} />
            </>
          )}

          {listening && !reduceMotion && (
            <span className="absolute inset-0 rounded-full bg-accent/40 animate-ping" />
          )}
          {speaking && !reduceMotion && (
            <span className="absolute -inset-1 rounded-full ring-2 ring-accent/40 animate-aiglow" />
          )}

          {/* Spherical depth — inner top highlight + lower shade */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{ boxShadow: 'inset 0 2px 5px rgba(255,255,255,0.25), inset 0 -7px 14px rgba(0,0,0,0.38)' }}
          />

          <span className="relative flex items-center justify-center">
            {busy ? <Loader2 className="w-6 h-6 animate-spin" />
              : speaking ? <Volume2 className="w-6 h-6" />
              : listening ? <Square className="w-5 h-5" />
              : <Mic className="w-6 h-6" />}
          </span>
        </button>
      </div>
    </>
  );
}
