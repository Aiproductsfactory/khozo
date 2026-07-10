import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('khozo_token');
    if (!token) return setLoading(false);
    api
      .get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => localStorage.removeItem('khozo_token'))
      .finally(() => setLoading(false));
  }, []);

  const finishAuth = ({ token, user }) => {
    localStorage.setItem('khozo_token', token);
    setUser(user);
    return user;
  };

  const login = (email, password) => api.post('/auth/login', { email, password }).then(finishAuth);
  const startOtp = (phone) => api.post('/auth/otp/start', { phone });
  const register = (payload) => api.post('/auth/register', payload).then(finishAuth);
  const changePassword = (payload) => api.post('/auth/change-password', payload).then(({ user }) => {
    setUser(user);
    return user;
  });
  const logout = () => {
    localStorage.removeItem('khozo_token');
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, startOtp, register, changePassword, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

export function AuthTestProvider({ value, children }) {
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center text-gray-400">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (user.mustChangePassword && loc.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

export function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <h2 className="text-lg font-semibold">Access restricted</h2>
        <p className="mt-1 text-sm text-amber-800">This dashboard section is not available for your role.</p>
        <a href="/app" className="mt-4 inline-flex rounded-lg bg-amber-900 px-3 py-2 text-sm font-semibold text-white">
          Return to overview
        </a>
      </div>
    );
  }
  return children;
}
