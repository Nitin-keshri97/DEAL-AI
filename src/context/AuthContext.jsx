import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getToken,
  setToken,
  clearToken,
  getMe,
  signup as apiSignup,
  login as apiLogin,
  updateProfile as apiUpdateProfile,
} from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// AuthContext — the logged-in user + the auth actions (Day 5).
//
// The bearer token is the single source of identity. It lives in localStorage
// (via lib/api's token helpers) and is attached to every protected request. On
// mount we re-hydrate the user from `/api/auth/me` using the stored token; if
// the token is missing/expired we simply stay logged out. No secret ever lives
// here — the token is a user credential, and `user` is the server's safe
// projection (never a passwordHash).
// ─────────────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(() => getToken());
  const [loading, setLoading] = useState(Boolean(getToken())); // hydrating an existing session?

  // Re-hydrate the user from a stored token on first mount.
  useEffect(() => {
    let cancelled = false;
    const existing = getToken();
    if (!existing) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const me = await getMe();
        if (!cancelled) setUser(me);
      } catch {
        // Token invalid/expired (or API down) — drop it and stay logged out.
        if (!cancelled) {
          clearToken();
          setTokenState(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = useCallback((nextToken, nextUser) => {
    setToken(nextToken);
    setTokenState(nextToken);
    setUser(nextUser);
  }, []);

  const signup = useCallback(
    async ({ name, email, password, confirmPassword }) => {
      const { token: t, user: u } = await apiSignup({ name, email, password, confirmPassword });
      applySession(t, u);
      return u;
    },
    [applySession]
  );

  const login = useCallback(
    async ({ email, password }) => {
      const { token: t, user: u } = await apiLogin({ email, password });
      applySession(t, u);
      return u;
    },
    [applySession]
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async ({ name }) => {
    const u = await apiUpdateProfile({ name });
    setUser(u);
    return u;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthed: Boolean(user && token),
        signup,
        login,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
