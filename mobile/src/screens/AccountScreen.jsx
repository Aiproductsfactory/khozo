import React, { useCallback, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Badge, Banner, Button, Card, Divider, ListRow, Screen, SectionHeader, Text } from '../components';
import { alertPermissionState } from '../services/alerts';
import { officerApi } from '../services/api';
import { roleLabel, useAuth } from '../services/auth';
import { getApiBaseUrl } from '../services/config';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';
import { initialsOf } from '../utils/format';

/** Whether the server can ring this phone, in words (push.status in services/auth.jsx). */
function pushStatusLine(push) {
  const others = push.devices > 1 ? ` ${push.devices} phones get your alerts.` : '';
  switch (push.status) {
    case 'registered':
      return { tone: 'success', text: `This phone will ring for sightings sent to your station, even when the app is closed.${others}` };
    case 'registering':
      return { tone: 'info', text: 'Setting up alerts on this phone…' };
    case 'no_project':
      return { tone: 'warning', text: 'This copy of the app cannot receive alerts while it is closed: alerts ring only while it is open. Ask your administrator for the latest Khozo app.' };
    case 'denied':
      return { tone: 'danger', text: 'Notifications are turned off for Khozo, so no alert will ring. Turn them on in the phone’s settings.' };
    case 'unsupported':
      return { tone: 'warning', text: 'Alerts ring only on a real phone.' };
    case 'password_change':
      return { tone: 'warning', text: 'Change your password on the Khozo website first. Alerts are set up after that.' };
    case 'failed':
      return { tone: 'danger', text: 'Alerts could not be set up on this phone. Check the connection and try again.' };
    default:
      return null;
  }
}

/** What the test alert did, in plain sentences (POST /api/dashboard/push-test). */
function testResultLines(result) {
  const push = result?.push || {};
  const sms = result?.sms || {};
  const pushLine = push.sent
    ? `Alert sent to ${push.devices === 1 ? 'your phone' : `${push.devices} phones`}. It should ring now.`
    : {
        no_device: 'No phone is set up for alerts on your account.',
        DeviceNotRegistered: 'This phone no longer accepts alerts. Sign out and sign in again.',
        InvalidCredentials: 'The app’s alert set-up is not finished. Tell your administrator.',
        push_failed: 'The alert service did not answer. Try again in a minute.',
      }[push.reason] || `The alert could not be sent (${push.reason || 'unknown'}). Tell your administrator.`;
  const smsLine = sms.sent
    ? 'SMS sent to your alert number.'
    : {
        no_phone: 'No SMS: there is no alert number on your account. Ask your administrator to add the station’s CUG mobile.',
        no_gateway: 'No SMS: Khozo is not connected to an SMS service yet.',
        gateway_failed: 'No SMS: the SMS service did not accept the message. Try again later.',
      }[sms.reason] || 'No SMS was sent.';
  return { pushLine, smsLine, ok: Boolean(push.sent) };
}

/**
 * "Alerts on this phone": whether a sighting sent to the officer's station
 * will actually ring here, a test that proves it, and the phone settings that
 * otherwise stop it. Many phones sold in India (Xiaomi, Oppo, Vivo, Realme)
 * stop apps in the background to save battery, and the alert never rings.
 */
function PhoneAlerts() {
  const theme = useTheme();
  const { token, push, retryPush, refresh } = useAuth();
  const [permission, setPermission] = useState('undetermined');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      alertPermissionState().then((state) => alive && setPermission(state));
      return () => {
        alive = false;
      };
    }, []),
  );

  const sendTest = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      const answer = await officerApi.pushTest(token);
      setResult(testResultLines(answer));
      refresh().catch(() => {});
    } catch (error) {
      setResult({ pushLine: error.message, smsLine: null, ok: false });
    } finally {
      setTesting(false);
    }
  }, [token, refresh]);

  const status = pushStatusLine(push);
  return (
    <>
      <SectionHeader title="Alerts on this phone" style={{ marginTop: theme.spacing.xl }} />
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          {status ? <Banner tone={status.tone} message={status.text} /> : null}
          {permission === 'denied' ? (
            <Banner tone="danger" icon="notifications-off-outline" title="Notifications are off" message="Turn on notifications for Khozo, or no alert will ring." />
          ) : null}
          <Button label="Send me a test alert" icon="megaphone-outline" loading={testing} onPress={sendTest} fullWidth />
          {result ? (
            <Banner tone={result.ok ? 'success' : 'warning'} title={result.pushLine} message={result.smsLine || undefined} />
          ) : null}
          {['failed', 'denied', 'no_project'].includes(push.status) ? (
            <Button label="Try setting up again" variant="secondary" icon="refresh-outline" onPress={() => retryPush().catch(() => {})} fullWidth />
          ) : null}
          {Platform.OS === 'android' ? (
            <>
              <Divider />
              <Text variant="smallStrong">So that alerts always ring</Text>
              <Text variant="small" tone="secondary">
                Some phones (Xiaomi, Redmi, Oppo, Vivo, Realme and others) stop apps in the background to save battery, and then an alert does
                not ring. In the phone’s settings for Khozo: allow it to start on its own (Autostart), set Battery to “No restrictions”, and
                allow it in Do Not Disturb so it rings at night.
              </Text>
              <Button
                label="Open Khozo’s phone settings"
                variant="ghost"
                icon="settings-outline"
                onPress={() => Linking.openSettings()}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
              />
            </>
          ) : null}
        </View>
      </Card>
    </>
  );
}

export default function AccountScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { user, isSignedIn, signOut, canReviewSightings, mustChangePassword } = useAuth();
  const { pendingCount, blockedCount, online } = useOutbox();

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out?', 'You will need your official email and password to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }, [signOut]);

  return (
    <Screen title="Account" edges={{ top: true, bottom: false }}>
      {isSignedIn ? (
        <Card>
          <View style={[styles.profile, { gap: theme.spacing.lg }]}>
            <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
              <Text variant="title" color={theme.colors.primarySoftText}>
                {initialsOf(user?.name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {user?.name}
              </Text>
              <Text variant="small" tone="muted" numberOfLines={1}>
                {user?.email}
              </Text>
              <Badge label={roleLabel(user?.role)} tone="primary" style={{ marginTop: theme.spacing.sm }} />
            </View>
          </View>

          {user?.org || user?.jurisdiction?.state ? (
            <>
              <Divider style={{ marginVertical: theme.spacing.lg }} />
              <View style={{ gap: theme.spacing.sm }}>
                {user?.org ? (
                  <View style={[styles.metaRow, { gap: theme.spacing.sm }]}>
                    <Ionicons name="business-outline" size={15} color={theme.colors.textMuted} />
                    <Text variant="small" tone="secondary">
                      {user.org}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.metaRow, { gap: theme.spacing.sm }]}>
                  <Ionicons name="map-outline" size={15} color={theme.colors.textMuted} />
                  <Text variant="small" tone="secondary">
                    {[user?.jurisdiction?.station, user?.jurisdiction?.district, user?.jurisdiction?.state]
                      .filter(Boolean)
                      .join(', ') || 'All jurisdictions'}
                  </Text>
                </View>
              </View>
            </>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Text variant="heading">Reporting does not need an account</Text>
          <Text variant="small" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
            Anyone can submit a sighting, browse public bulletins and track a case. Sign in only if you are a police, CWC, RPF,
            DCPU or partner officer with a Khozo account.
          </Text>
          <Button
            label="Official sign in"
            icon="shield-half-outline"
            onPress={() => navigation.navigate('SignIn')}
            fullWidth
            style={{ marginTop: theme.spacing.lg }}
          />
        </Card>
      )}

      {mustChangePassword ? (
        <Banner
          tone="warning"
          icon="key-outline"
          title="Password change required"
          message="Your account still uses a provisioned password. Operational actions stay blocked until you change it on the Khozo web dashboard."
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      {isSignedIn && canReviewSightings ? <PhoneAlerts /> : null}

      <SectionHeader title="Reports" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <ListRow
          icon="cloud-upload-outline"
          iconTone={pendingCount || blockedCount ? 'warning' : 'success'}
          title="Unsent reports"
          subtitle={
            pendingCount || blockedCount
              ? `${pendingCount} waiting${blockedCount ? `, ${blockedCount} need attention` : ''}`
              : 'Everything has been sent'
          }
          onPress={() => navigation.navigate('Outbox')}
        />
        <Divider />
        <ListRow
          icon="search-outline"
          iconTone="info"
          title="Track a case"
          subtitle="Look up a receipt, case or FIR number"
          onPress={() => navigation.navigate('Track')}
        />
        <Divider />
        <ListRow
          icon="megaphone-outline"
          iconTone="primary"
          title="Public bulletins"
          subtitle="Published missing-child bulletins"
          onPress={() => navigation.navigate('Bulletins')}
        />
      </Card>

      <SectionHeader title="App" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <ListRow
          icon="server-outline"
          iconTone={online ? 'success' : 'danger'}
          title="Server"
          subtitle={getApiBaseUrl()}
          onPress={() => navigation.navigate('Settings')}
        />
        <Divider />
        <ListRow
          icon="call-outline"
          iconTone="danger"
          title="Childline 1098"
          subtitle="24x7 helpline for a child in distress"
          onPress={() => Linking.openURL('tel:1098')}
        />
        <Divider />
        <ListRow
          icon="information-circle-outline"
          iconTone="neutral"
          title="About Khozo"
          subtitle="Version 1.0.0 · An AI Products factory initiative"
          onPress={() => Linking.openURL('https://aiproductsfactory.com')}
        />
      </Card>

      {isSignedIn ? (
        <Button label="Sign out" variant="secondary" icon="log-out-outline" onPress={confirmSignOut} fullWidth style={{ marginTop: theme.spacing.xl }} />
      ) : null}

      {canReviewSightings ? (
        <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.lg, textAlign: 'center' }}>
          Case actions are limited to your jurisdiction and are recorded in the Khozo audit log.
        </Text>
      ) : null}

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
});
