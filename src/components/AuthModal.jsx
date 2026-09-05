import { useEffect, useRef, useState } from 'react';
import { X, Mail, Lock, User as UserIcon, Eye, EyeOff, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';

// ─────────────────────────────────────────────────────────────────────────
// AuthModal — Login / Sign-Up overlay.
//
// Validates required fields, email format, password length and confirm-match
// on the client for fast feedback, but the SERVER is authoritative (duplicate
// email, wrong password, etc.) and its message is shown verbatim. No password
// or token is ever logged; nothing sensitive is stored beyond the token that
// AuthContext persists via lib/api.
// ─────────────────────────────────────────────────────────────────────────

const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthModal() {
  const { authModal, closeAuth, openAuth } = useUI();
  const { login, signup } = useAuth();

  const isSignup = authModal === 'signup';
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const firstFieldRef = useRef(null);

  const open = authModal !== null;

  // Reset transient state whenever the modal opens or switches mode.
  useEffect(() => {
    if (!open) return;
    setError('');
    setSuccess(false);
    setSubmitting(false);
    setShowPw(false);
    const t = setTimeout(() => firstFieldRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open, isSignup]);

  // Escape to close + scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && closeAuth();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, closeAuth]);

  if (!open) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function clientValidation() {
    const name = form.name.trim();
    const email = form.email.trim();
    if (isSignup && !name) return 'Please enter your name.';
    if (isSignup && name.length > 60) return 'That name is too long.';
    if (!EMAIL_RE.test(email)) return 'Please enter a valid email address.';
    if (!form.password) return 'Please enter your password.';
    if (isSignup && form.password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
    if (isSignup && form.confirmPassword !== form.password) return 'Passwords do not match.';
    return '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    const problem = clientValidation();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        await signup({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          confirmPassword: form.confirmPassword,
        });
      } else {
        await login({ email: form.email.trim(), password: form.password });
      }
      setSuccess(true);
      // Let the user see the confirmation, then close.
      setTimeout(() => closeAuth(), 650);
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="modal-overlay fixed inset-0 z-[70] bg-black/50" onClick={closeAuth} aria-hidden="true" />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isSignup ? 'Create your account' : 'Log in'}
          className="modal-content pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4">
            <button
              type="button"
              onClick={closeAuth}
              aria-label="Close"
              className="absolute right-4 top-4 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" fill="white" />
              </div>
              <span className="text-lg font-bold tracking-tight">
                Deal<span className="text-indigo-600">AI</span>
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-gray-900">
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {isSignup ? 'Sign up to save orders and get a personalized agent.' : 'Log in to see your orders and personalized deals.'}
            </p>
          </div>

          {/* Tabs */}
          <div className="px-6">
            <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => openAuth('login')}
                className={`py-2 text-sm font-semibold rounded-md transition-colors ${!isSignup ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => openAuth('signup')}
                className={`py-2 text-sm font-semibold rounded-md transition-colors ${isSignup ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Sign Up
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="px-6 py-5 flex flex-col gap-3">
            {isSignup && (
              <Field label="Full name" icon={UserIcon}>
                <input
                  ref={firstFieldRef}
                  type="text"
                  autoComplete="name"
                  value={form.name}
                  onChange={set('name')}
                  placeholder="Ada Lovelace"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </Field>
            )}

            <Field label="Email" icon={Mail}>
              <input
                ref={isSignup ? undefined : firstFieldRef}
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={set('email')}
                placeholder="you@example.com"
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </Field>

            <Field label="Password" icon={Lock}>
              <input
                type={showPw ? 'text' : 'password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={set('password')}
                placeholder={isSignup ? `At least ${PASSWORD_MIN} characters` : 'Your password'}
                className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </Field>

            {isSignup && (
              <Field label="Confirm password" icon={Lock}>
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                  placeholder="Re-enter your password"
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </Field>
            )}

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || success}
              className="btn-accent w-full py-2.5 mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {success ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> {isSignup ? 'Account created' : 'Logged in'}
                </span>
              ) : submitting ? (
                isSignup ? 'Creating account…' : 'Logging in…'
              ) : isSignup ? (
                'Create account'
              ) : (
                'Log in'
              )}
            </button>

            <p className="text-center text-xs text-gray-400 mt-1">
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              <button
                type="button"
                onClick={() => openAuth(isSignup ? 'login' : 'signup')}
                className="text-indigo-600 font-semibold hover:underline"
              >
                {isSignup ? 'Log in' : 'Sign up'}
              </button>
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

// Labelled input wrapper with a leading icon. Children render the actual control.
function Field({ label, icon: Icon, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <div className="relative mt-1">
        <Icon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        {children}
      </div>
    </label>
  );
}
