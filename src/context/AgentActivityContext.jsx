import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// AgentActivityContext — a tiny shared mirror of the LIVE agent state.
//
// The VoiceAgent owns all the real work (speech, SSE streaming, cart actions).
// It additively *publishes* its current phase + real tool steps here so other
// parts of the UI (the Hero's AI-activity card) can reflect genuine activity.
//
// This never drives any backend work and never invents progress — it only
// mirrors state the VoiceAgent already computed from real stream events.
// Consumers get a safe default when no provider is mounted.
// ─────────────────────────────────────────────────────────────────────────

const AgentActivityContext = createContext(null);

const IDLE = { phase: 'idle', steps: [] };

export function AgentActivityProvider({ children }) {
  const [activity, setActivityState] = useState(IDLE);

  const setActivity = useCallback((next) => {
    setActivityState((prev) => ({ ...prev, ...next }));
  }, []);

  const value = useMemo(() => ({ activity, setActivity }), [activity, setActivity]);

  return <AgentActivityContext.Provider value={value}>{children}</AgentActivityContext.Provider>;
}

export function useAgentActivity() {
  return useContext(AgentActivityContext) || { activity: IDLE, setActivity: () => {} };
}

export default AgentActivityContext;
