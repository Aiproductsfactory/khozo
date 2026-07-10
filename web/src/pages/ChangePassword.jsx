import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';

export default function ChangePassword() {
  const { user, loading, changePassword, logout } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="grid min-h-screen place-items-center text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/app" replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (form.newPassword !== form.confirmPassword) {
      setErr('New password and confirmation do not match');
      return;
    }
    setBusy(true);
    try {
      await changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      nav('/app', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm ring-1 ring-black/5">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">Change temporary password</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your official account was provisioned with a one-time password. Set a new password before opening case workflows.
        </p>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label">Temporary password</label>
            <input className="field" type="password" value={form.currentPassword} onChange={set('currentPassword')} required />
          </div>
          <div>
            <label className="label">New password</label>
            <input className="field" type="password" minLength={8} value={form.newPassword} onChange={set('newPassword')} required />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input className="field" type="password" minLength={8} value={form.confirmPassword} onChange={set('confirmPassword')} required />
          </div>
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <button className="mt-4 w-full text-sm font-semibold text-gray-500 hover:text-gray-800" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
}
