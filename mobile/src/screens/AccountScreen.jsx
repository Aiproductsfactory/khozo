import React, { useCallback } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { Badge, Banner, Button, Card, Divider, ListRow, Screen, SectionHeader, Text } from '../components';
import { roleLabel, useAuth } from '../services/auth';
import { getApiBaseUrl } from '../services/config';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';
import { initialsOf } from '../utils/format';

export default function AccountScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { user, isSignedIn, signOut, canReviewSightings, mustChangePassword } = useAuth();
  const { pendingCount, blockedCount, online } = useOutbox();

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out?', 'You will need your official credentials to sign in again.', [
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
          subtitle="Version 1.0.0 · An Aegis School of Data Science initiative"
          right={null}
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
