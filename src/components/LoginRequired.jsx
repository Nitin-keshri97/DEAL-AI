import { Lock, LogIn } from 'lucide-react';
import { useUI } from '../context/UIContext';

// ─────────────────────────────────────────────────────────────────────────
// LoginRequired — the friendly gate shown on protected pages when the visitor
// isn't logged in. Never a blank screen (spec PART 22): it explains why and
// offers a clear way in.
// ─────────────────────────────────────────────────────────────────────────

export default function LoginRequired({
  title = 'Please log in',
  message = 'You need to be logged in to view this page.',
}) {
  const { openAuth, goShop } = useUI();
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center flex flex-col items-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
        <Lock className="w-7 h-7 text-indigo-600" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{message}</p>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={() => openAuth('login')} className="btn-accent gap-1.5">
          <LogIn className="w-4 h-4" /> Log in
        </button>
        <button type="button" onClick={() => openAuth('signup')} className="btn-outline">
          Sign up
        </button>
      </div>
      <button type="button" onClick={goShop} className="text-sm text-gray-400 hover:text-gray-600 mt-1">
        ← Back to shopping
      </button>
    </div>
  );
}

// A small centered spinner for the brief window while an existing session
// re-hydrates from its stored token.
export function PageLoading({ label = 'Loading…' }) {
  return (
    <div className="max-w-md mx-auto px-4 py-24 flex flex-col items-center gap-3 text-gray-400">
      <div className="dot-flashing" role="status" aria-label={label}>
        <span />
        <span />
        <span />
      </div>
      <p className="text-sm">{label}</p>
    </div>
  );
}
