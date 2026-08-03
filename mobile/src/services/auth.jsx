import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import { ApiError, authApi } from './api';

const TOKEN_KEY = 'khozo.token';

/** Roles allowed to open the officer review queue (mirrors REVIEW_ROLES on the server). */
const REVIEW_ROLES = new Set([
  'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'admin', 'super_admin', 'cwc', 'dcpu',
  'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau',
]);

/** Roles allowed to confirm a reunification (mirrors FORMAL_CASE_ROLES). */
const CONFIRM_ROLES = new Set(['police', 'sjpu', 'admin', 'super_admin']);

export const ROLE_LABELS = {
  super_admin: 'National command',
  admin: 'State administrator',
  police: 'Police station',
  sjpu: 'Special Juvenile Police Unit',
  ahtu: 'Anti Human Trafficking Unit',
  dcrb: 'District crime records bureau',
  dlsa: 'District legal services authority',
  cwc: 'Child Welfare Committee',
  dcpu: 'District Child Protection Unit',
  rpf: 'Railway Protection Force',
  cci: 'Child Care Institution',
  saa: 'Specialised adoption agency',
  jjb: 'Juvenile Justice Board',
  state_nodal: 'State nodal officer',
  sara: 'State adoption resource agency',
  crime_bureau: 'Crime records bureau',
  parent: 'Parent / guardian',
  ngo: 'NGO partner',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || 'Khozo user';
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);

  // Restore a previous session on cold start, and drop it if the server has
  // since rejected the token (expired, user deleted, secret rotated).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!stored) return;
        const { user: me } = await authApi.me(stored);
        if (cancelled) return;
        setToken(stored);
        setUser(me);
      } catch (error) {
        // Only discard the token when the server actively rejected it. A
        // network failure must not sign an officer out mid-shift.
        if (error instanceof ApiError && error.status === 401) {
          await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        } else {
          const stored = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
          if (stored && !cancelled) setToken(stored);
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const result = await authApi.login(String(email || '').trim(), password);
    await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return null;
    const { user: me } = await authApi.me(token);
    setUser(me);
    return me;
  }, [token]);

  const value = useMemo(
    () => ({
      token,
      user,
      restoring,
      signIn,
      signOut,
      refresh,
      isSignedIn: Boolean(token && user),
      canReviewSightings: Boolean(user && REVIEW_ROLES.has(user.role)),
      canConfirmMatch: Boolean(user && CONFIRM_ROLES.has(user.role)),
      mustChangePassword: Boolean(user?.mustChangePassword),
    }),
    [token, user, restoring, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
