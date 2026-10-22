import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { ApiError, authApi, officerApi } from './api';
import { deviceName, getPushToken } from './alerts';

const TOKEN_KEY = 'khozo.token';
/** The push token this phone registered, kept so signing out can unregister it. */
const PUSH_TOKEN_KEY = 'khozo.pushToken';

/** Roles allowed to open the officer review queue (mirrors REVIEW_ROLES on the server). */
const REVIEW_ROLES = new Set([
  'police', 'sjpu', 'ahtu', 'dcrb', 'dlsa', 'admin', 'super_admin', 'cwc', 'dcpu',
  'rpf', 'cci', 'saa', 'jjb', 'state_nodal', 'sara', 'crime_bureau',
]);

/** Roles allowed to confirm a reunification (mirrors FORMAL_CASE_ROLES). */
const CONFIRM_ROLES = new Set(['police', 'sjpu', 'admin', 'super_admin']);

/**
 * Roles that can be sent a sighting as a station or a control room, and
 * answer it (mirrors POLICE_ROLES in shared/scope.js).
 */
const POLICE_ROLES = new Set(['police', 'sjpu', 'ahtu', 'dcrb', 'crime_bureau', 'admin', 'super_admin']);

export const ROLE_LABELS = {
  super_admin: 'National command',
  admin: 'State administrator',
  police: 'Police station',
  sjpu: 'Special Juvenile Police Unit',
  ahtu: 'Anti-Human Trafficking Unit',
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
  // Whether the server can ring this phone: { status, devices }. status is
  // 'off' (not an official), 'registering', 'registered', 'password_change',
  // or why not, from getPushToken ('no_project', 'denied', 'unsupported',
  // 'failed').
  const [push, setPush] = useState({ status: 'off', devices: 0 });

  /**
   * Registers this phone for the server's push alerts. Best effort and never
   * awaited by sign-in: an officer whose phone cannot get push still signs in,
   * and the Account screen says why alerts will not ring.
   */
  const registerPush = useCallback(async (sessionToken, me) => {
    if (!sessionToken || !me || !REVIEW_ROLES.has(me.role)) {
      setPush({ status: 'off', devices: 0 });
      return;
    }
    // The server refuses every officer action until a provisioned password
    // has been changed, this one included.
    if (me.mustChangePassword) {
      setPush({ status: 'password_change', devices: me.alertDevices || 0 });
      return;
    }
    setPush((current) => ({ ...current, status: 'registering' }));
    const { token: pushToken, reason } = await getPushToken();
    if (!pushToken) {
      setPush({ status: reason, devices: me.alertDevices || 0 });
      return;
    }
    try {
      const result = await officerApi.registerPushToken(sessionToken, pushToken, { platform: Platform.OS, deviceName: deviceName() });
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, pushToken).catch(() => {});
      setPush({ status: 'registered', devices: Number(result?.devices) || 1 });
    } catch {
      setPush({ status: 'failed', devices: me.alertDevices || 0 });
    }
  }, []);

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
        // Again on every start: a token Expo has rotated, or one the server
        // dropped because the phone stopped answering, is replaced.
        registerPush(stored, me).catch(() => {});
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
  }, [registerPush]);

  const signIn = useCallback(async (email, password) => {
    const result = await authApi.login(String(email || '').trim(), password);
    await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    setToken(result.token);
    setUser(result.user);
    registerPush(result.token, result.user).catch(() => {});
    return result.user;
  }, [registerPush]);

  /**
   * Signing out stops this phone's alerts first, while the sign-in token can
   * still say whose they are. Offline, the server keeps ringing this phone
   * for the old account until someone signs in on it again, which moves the
   * phone to the new account (POST /api/dashboard/push-token).
   */
  const signOut = useCallback(async () => {
    const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
    if (pushToken && token) await officerApi.removePushToken(token, pushToken).catch(() => {});
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    setToken(null);
    setUser(null);
    setPush({ status: 'off', devices: 0 });
  }, [token]);

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
      canAnswerStationAlerts: Boolean(user && POLICE_ROLES.has(user.role)),
      mustChangePassword: Boolean(user?.mustChangePassword),
      push,
      // For the Account screen's "Try again".
      retryPush: () => registerPush(token, user),
    }),
    [token, user, restoring, signIn, signOut, refresh, push, registerPush],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
