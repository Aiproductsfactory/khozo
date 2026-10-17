import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';
import { LanguageSwitcher, msg, useT } from '../i18n.jsx';

const ROLES = [
  { id: 'parent', t: msg('Parent / Public'), d: msg('Report a missing child or a child you spotted.') },
  { id: 'ngo', t: 'NGO', d: msg('Help the community report and register children.') },
];

export default function Register() {
  const t = useT();
  const { register, startOtp } = useAuth();
  const nav = useNavigate();
  const [role, setRole] = useState('parent');
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', otp: '', org: '', state: '', district: '', station: '' });
  const [otpState, setOtpState] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const requestOtp = async () => {
    setErr('');
    setBusy(true);
    try {
      const data = await startOtp(form.phone);
      setOtpState(data);
      if (data.demoOtp) setForm((f) => ({ ...f, otp: data.demoOtp }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await register({ ...form, role });
      nav('/app');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8f5]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-6">
        <Logo />
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Link to="/login" className="inline-flex min-h-11 items-center text-sm font-semibold text-khozo hover:underline">{t('Already have an account?')}</Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <h1 className="text-3xl font-bold">{t('Create your Khozo account')}</h1>
        <p className="mt-1 text-gray-500">{t('Public registration is for parents, citizens, and NGOs. Police and government accounts are provisioned by an administrator.')}</p>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">
          <div>
            <p className="label">{t('I am a...')}</p>
            <div className="space-y-3">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setRole(r.id)}
                  className={`w-full rounded-2xl border-2 p-4 text-left transition ${
                    role === r.id ? 'border-khozo bg-khozo-light' : 'border-transparent bg-white ring-1 ring-black/5 hover:border-khozo/40'
                  }`}
                >
                  <p className="font-semibold">{t(r.t)}</p>
                  <p className="text-sm text-gray-500">{t(r.d)}</p>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={submit} className="card space-y-4 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">{t('Full name')} *</label>
                <input className="field" autoComplete="name" value={form.name} onChange={set('name')} required />
              </div>
              <div>
                <label className="label">{t('Email')} *</label>
                <input className="field" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={form.email} onChange={set('email')} required />
              </div>
              <div>
                <label className="label">{t('Mobile no.')}</label>
                <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
              </div>
              <div>
                <label className="label">OTP *</label>
                <div className="flex gap-2">
                  <input className="field" inputMode="numeric" autoComplete="one-time-code" value={form.otp} onChange={set('otp')} required />
                  <button type="button" className="btn-ghost shrink-0" disabled={busy || form.phone.trim().length < 7} onClick={requestOtp}>
                    {t('Send OTP')}
                  </button>
                </div>
                {otpState && (
                  <p className="mt-1 text-xs text-gray-400">
                    {otpState.demoOtp ? t('OTP sent / demo {otp}.', { otp: otpState.demoOtp }) : t('OTP sent.')}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('Password')} *</label>
                <input className="field" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
              </div>

              {role === 'ngo' && (
                <div className="sm:col-span-2">
                  <label className="label">{t('Organisation')}</label>
                  <input className="field" autoComplete="organization" value={form.org} onChange={set('org')} placeholder={t('e.g. registered NGO name')} />
                </div>
              )}
              <div>
                <label className="label">{t('State')}</label>
                <input className="field" autoComplete="address-level1" value={form.state} onChange={set('state')} placeholder={t('Maharashtra')} />
              </div>
              <div>
                <label className="label">{t('District')}</label>
                <input className="field" autoComplete="address-level2" value={form.district} onChange={set('district')} placeholder={t('Mumbai')} />
              </div>
            </div>

            <button className="btn-primary w-full py-3" disabled={busy}>
              {busy ? t('Creating account...') : t('Create account')}
            </button>
            <p className="text-center text-xs text-gray-400">
              {t("By registering you agree to Khozo's data-protection terms.")}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
