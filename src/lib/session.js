// Shared DealAI agent session id.
//
// The negotiation the customer strikes in the agent panel is stored SERVER-SIDE
// keyed by this id. Checkout must read the SAME id so the server can apply that
// negotiation to the order — the client never carries the negotiated price
// itself. One stable id per browser, persisted in localStorage.
const SESSION_KEY = 'dealai_agent_session';

export function getAgentSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s_${Date.now()}`;
  }
}
