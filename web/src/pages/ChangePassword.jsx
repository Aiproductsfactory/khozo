import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';
import { LanguageSwitcher, msg, useT } from '../i18n.jsx';
import { usePageMeta } from '../PublicChrome.jsx';

export default function ChangePassword() {
  const t = useT();
  usePageMeta({ title: msg('Change password'), noindex: true });
  const { user, loading, changePassword, logout } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="grid min-h-screen place-items-center text-gray-400">{t('Loading...')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Reached two ways: forced, after signing in with a one-time password, or by
  // choice from the console's account menu. Only the wording differs.
  const forced = Boolean(user.mustChangePassword);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (form.newPassword !== form.confirmPassword) {
      setErr(t('New password and confirmation do not match'));
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
    <div className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-6 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <Logo />
          <LanguageSwitcher />
        </div>
        <h1 className="mt-6 text-2xl font-bold">{forced ? t('Change temporary password') : t('Change password')}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {forced
            ? t('Your official account was created with a one-time password. Set a new password before opening any case.')
            : t('Choose a new password of at least 8 characters.')}
        </p>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="current-password">{forced ? t('Temporary password') : t('Current password')}</label>
            <input id="current-password" className="field" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
          </div>
          <div>
            <label className="label" htmlFor="new-password">{t('New password')}</label>
            <input id="new-password" className="field" type="password" autoComplete="new-password" minLength={8} value={form.newPassword} onChange={set('newPassword')} required />
          </div>
          <div>
            <label className="label" htmlFor="confirm-password">{t('Confirm new password')}</label>
            <input id="confirm-password" className="field" type="password" autoComplete="new-password" minLength={8} value={form.confirmPassword} onChange={set('confirmPassword')} required />
          </div>
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? t('Updating...') : t('Update password')}
          </button>
        </form>

        {forced ? (
          <button className="mt-4 w-full text-sm font-semibold text-gray-500 hover:text-gray-800" onClick={logout}>
            {t('Log out')}
          </button>
        ) : (
          <button className="mt-4 w-full text-sm font-semibold text-gray-500 hover:text-gray-800" onClick={() => nav('/app')}>
            {t('Cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
