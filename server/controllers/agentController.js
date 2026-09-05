import { runAgent, runAgentStream } from '../services/agentService.js';

// ─────────────────────────────────────────────────────────────────────────
// agentController.js — POST /api/agent/chat & POST /api/agent/stream
//
// Request:  { message, cart?: [{productId|id, quantity}], sessionId?, history? }
// Response: { success, message, actions[], products[], cartActions[],
//             pendingConfirmation, cartUpdated, negotiation, sessionId }
//
// Never leaks stack traces or secrets. Input sizes are bounded. The heavy
// lifting (tool loop, validation, guardrails) lives in agentService.
// ─────────────────────────────────────────────────────────────────────────

const MAX_MESSAGE_LEN = 2000;
const MAX_CART_ITEMS = 50;
const MAX_HISTORY_ITEMS = 20;

export async function chat(req, res) {
  try {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ success: false, error: 'A message is required.' });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ success: false, error: 'That message is too long.' });
    }

    // Normalise the client cart to the minimal shape the agent expects.
    const cart = Array.isArray(body.cart)
      ? body.cart.slice(0, MAX_CART_ITEMS).map((it) => ({
          productId: it?.productId ?? it?.id,
          quantity: it?.quantity,
        }))
      : [];

    const history = Array.isArray(body.history)
      ? body.history
          .slice(-MAX_HISTORY_ITEMS)
          .filter((h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
          .map((h) => ({ role: h.role, text: h.text.slice(0, MAX_MESSAGE_LEN) }))
      : [];

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;

    // Identity comes ONLY from the verified token (optionalAuth → req.userId),
    // NEVER from the request body — a client cannot impersonate another user.
    const userId = req.userId || null;

    const result = await runAgent({ message, cart, sessionId, history, userId });
    return res.json({ success: true, ...result });
  } catch (err) {
    // Never expose internals to the client.
    console.error('[DealAI] Agent chat error:', err);
    return res.status(500).json({
      success: false,
      error: 'DealAI ran into a problem handling that. Please try again.',
    });
  }
}

/**
 * POST /api/agent/stream — SSE real-time streaming endpoint for VoiceAgent
 */
export async function stream(req, res) {
  const t0 = Date.now();
  const logEvent = (name, extra = '') => {
    console.log(`[DealAI][SSE][+${Date.now() - t0}ms] ${name} ${extra}`);
  };

  logEvent('STREAM_CONNECTED');

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ success: false, error: 'A message is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.socket) {
    res.socket.setNoDelay(true);
  }
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let isAborted = false;
  // Detect a genuine client disconnect via the RESPONSE (connection) close.
  // NOTE: do NOT use req.on('close') here — express.json() fully consumes the
  // POST body before this handler runs, and Node then fires the request
  // stream's 'close' event immediately. That false positive would mark the
  // stream aborted before the first tool event and silently drop every event
  // after 'start' (and skip res.end(), hanging the connection).
  res.on('close', () => {
    isAborted = true;
  });

  const sendEvent = (data) => {
    if (isAborted) return;
    try {
      if (data.type === 'start') logEvent('START_SENT');
      else if (data.type === 'tool_start') logEvent('TOOL_START_SENT', `${data.tool} (${data.label || ''})`);
      else if (data.type === 'tool_complete') logEvent('TOOL_COMPLETE_SENT', `${data.tool}`);
      else if (data.type === 'text_delta') logEvent('TEXT_DELTA_SENT', `${(data.text || '').slice(0, 30)}...`);
      else if (data.type === 'complete') logEvent('COMPLETE_SENT');

      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch {
      isAborted = true;
    }
  };

  try {
    const cart = Array.isArray(body.cart)
      ? body.cart.slice(0, MAX_CART_ITEMS).map((it) => ({
          productId: it?.productId ?? it?.id,
          quantity: it?.quantity,
        }))
      : [];

    const history = Array.isArray(body.history)
      ? body.history
          .slice(-MAX_HISTORY_ITEMS)
          .filter((h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
          .map((h) => ({ role: h.role, text: h.text.slice(0, MAX_MESSAGE_LEN) }))
      : [];

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    const userId = req.userId || null;

    await runAgentStream({
      message,
      cart,
      sessionId,
      history,
      userId,
      onEvent: (evt) => sendEvent(evt),
    });
  } catch (err) {
    console.error('[DealAI] Agent stream error:', err);
    sendEvent({ type: 'error', message: 'Stream failed' });
  } finally {
    if (!isAborted) {
      res.end();
    }
  }
}
