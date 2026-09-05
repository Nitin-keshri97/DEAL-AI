import { useState } from 'react';
import { Mail, Calendar, Pencil, Check, X, LogOut, Package, ShoppingBag } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI, VIEWS } from '../context/UIContext';
import LoginRequired, { PageLoading } from './LoginRequired';

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '—';
  }
};

export default function ProfilePage() {
  const { user, loading, isAuthed, updateProfile, logout } = useAuth();
  const { navigate, goShop } = useUI();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <PageLoading label="Loading your profile…" />;
  if (!isAuthed) return <LoginRequired title="Your profile" message="Log in to view and edit your account details." />;

  const startEdit = () => {
    setName(user.name);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateProfile({ name: trimmed });
      setEditing(false);
    } catch (err) {
      setError(err?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const initial = (user.name || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-extrabold text-gray-900 mb-6">My Profile</h1>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header band with avatar */}
        <div className="flex items-center gap-4 p-6 border-b border-gray-100">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shrink-0"
            style={{ backgroundColor: user.avatarColor || '#4f46e5' }}
            aria-hidden="true"
          >
            {initial}
          </div>
          <div className="min-w-0">
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Your name"
              />
            ) : (
              <p className="text-xl font-extrabold text-gray-900 truncate">{user.name}</p>
            )}
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
              <Mail className="w-3.5 h-3.5" /> {user.email}
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400">Member since</span>
            <span className="font-medium text-gray-700">{fmtDate(user.createdAt)}</span>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Edit / Save controls */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {editing ? (
              <>
                <button type="button" onClick={save} disabled={saving} className="btn-accent gap-1.5 disabled:opacity-60">
                  <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-outline gap-1.5">
                  <X className="w-4 h-4" /> Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={startEdit} className="btn-outline gap-1.5">
                <Pencil className="w-4 h-4" /> Edit name
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <button
          type="button"
          onClick={() => navigate(VIEWS.ORDERS)}
          className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 p-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Package className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">My Orders</p>
            <p className="text-xs text-gray-400">View your order history</p>
          </div>
        </button>
        <button
          type="button"
          onClick={goShop}
          className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 p-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Continue Shopping</p>
            <p className="text-xs text-gray-400">Back to the store</p>
          </div>
        </button>
      </div>

      {/* Logout */}
      <button
        type="button"
        onClick={() => {
          logout();
          goShop();
        }}
        className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700"
      >
        <LogOut className="w-4 h-4" /> Log out
      </button>
    </div>
  );
}
