import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components.jsx';

const DEMO = [
  { role: 'Super Admin', email: 'superadmin@khozo.org' },
  { role: 'Admin (ACP)', email: 'admin@khozo.org' },
  { role: 'Police', email: 'police@khozo.org' },
  { role: 'SJPU', email: 'sjpu@khozo.org' },
  { role: 'AHTU', email: 'ahtu@khozo.org' },
  { role: 'DCRB', email: 'dcrb@khozo.org' },
  { role: 'DLSA', email: 'dlsa@khozo.org' },
  { role: 'CWC', email: 'cwc@khozo.org' },
  { role: 'DCPU', email: 'dcpu@khozo.org' },
  { role: 'RPF', email: 'rpf@khozo.org' },
  { role: 'CCI', email: 'cci@khozo.org' },
  { role: 'SAA', email: 'saa@khozo.org' },
  { role: 'JJB', email: 'jjb@khozo.org' },
  { role: 'State Nodal', email: 'nodal@khozo.org' },
  { role: 'SARA', email: 'sara@khozo.org' },
  { role: 'Crime Bureau', email: 'crimebureau@khozo.org' },
  { role: 'Parent', email: 'parent@khozo.org' },
  { role: 'NGO', email: 'ngo@khozo.org' },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const user = await login(email, password);
      nav(user.mustChangePassword ? '/change-password' : '/app');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('khozo123');
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="khozo-mesh relative hidden flex-col justify-between p-12 text-white lg:flex">
        <Logo light />
        <div>
          <h1 className="text-4xl font-bold leading-tight">Welcome back.</h1>
          <p className="mt-4 max-w-md text-white/85">
            Every login brings a missing child one step closer to home. Sign in to your Khozo
            dashboard.
          </p>
        </div>
        <p className="text-sm text-white/70">Aegis School of Data Science · Data Science for Social Good</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden"><Logo /></div>
          <h2 className="mt-6 text-2xl font-bold">Log in to Khozo</h2>
          <p className="mt-1 text-sm text-gray-500">Please log in to your account.</p>

          {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label">Email address</label>
              <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.gov.in" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <button className="btn-primary w-full py-3" disabled={busy}>
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </form>

          <div className="mt-6 rounded-xl bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Demo accounts · password khozo123</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => useDemo(d.email)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium ring-1 ring-black/10 hover:bg-khozo-light">
                  {d.role}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-sm text-gray-500">
            New here?{' '}
            <Link to="/register" className="font-semibold text-khozo hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
