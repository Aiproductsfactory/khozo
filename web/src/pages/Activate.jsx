import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';
import { LanguageSwitcher, msg, useT } from '../i18n.jsx';
import { roleLabel } from '../lib.jsx';
import { usePageMeta } from '../PublicChrome.jsx';

/**
 * Where an officer added from a sheet sets their own password: the one-time
 * link they were sent (shared/bulk-accounts.js) opens this page with their
 * email and code. The account is named first, so a link sent to the wrong
 * person is noticed before it is used.
 */
export default function Activate() {
  const t = useT();
  usePageMeta({ title: msg('Activate your account'), noindex: true });
  const { activate } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('e') || '';
  const code = params.get('c') || '';
  // null while checking; { name, email, role, place } when the link works.
  const [account, setAccount] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!email || !code) {
      setLinkError(t('This link is incomplete. Open the whole link you were sent, or ask your state desk for a new one.'));
      return;
    }
    api.post('/auth/activate/check', { email, code })
      .then(setAccount)
      .catch((e) => setLinkError(e.message));
    // The link is read once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, code]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (form.password !== form.confirm) {
      setErr(t('New password and confirmation do not match'));
      return;
    }
    setBusy(true);
    try {
      await activate({ email, code, password: form.password });
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
        <h1 className="mt-6 text-2xl font-bold">{t('Activate your account')}</h1>
        {linkError ? (
          <>
            <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{linkError}</div>
            <Link to="/login" className="btn-ghost mt-4 w-full py-3">{t('Go to sign in')}</Link>
          </>
        ) : !account ? (
          <p className="mt-4 text-sm text-gray-500">{t('Checking your link…')}</p>
        ) : (
          <>
            <div className="mt-3 rounded-xl bg-gray-50 px-4 py-3 text-sm">
              <p className="font-semibold text-ink">{account.name}</p>
              <p className="text-gray-600">{[roleLabel(account.role), account.place].filter(Boolean).join(' · ')}</p>
              <p className="text-gray-500">{account.email}</p>
            </div>
            <p className="mt-3 text-sm text-gray-500">
              {t('If this is not you, close this page and tell whoever sent you the link. Otherwise choose a password of at least 8 characters.')}
            </p>
            {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label className="label" htmlFor="activate-password">{t('New password')}</label>
                <input id="activate-password" className="field" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required />
              </div>
              <div>
                <label className="label" htmlFor="activate-confirm">{t('Confirm new password')}</label>
                <input id="activate-confirm" className="field" type="password" autoComplete="new-password" minLength={8} value={form.confirm} onChange={set('confirm')} required />
              </div>
              <button className="btn-primary w-full py-3" disabled={busy}>
                {busy ? t('Updating...') : t('Set password and sign in')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
