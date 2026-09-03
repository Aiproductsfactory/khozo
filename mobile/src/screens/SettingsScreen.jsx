import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Banner, Card, Divider, Button, Screen, SectionHeader, Text } from '../components';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const { online, pendingCount, flush, flushing } = useOutbox();

  return (
    <Screen edges={{ top: false, bottom: false }}>
      <SectionHeader title="Connection" />
      <Card padded={false}>
        <View style={[styles.statusRow, { padding: theme.spacing.lg, gap: theme.spacing.md }]}>
          <Ionicons name={online ? 'wifi' : 'cloud-offline'} size={20} color={online ? theme.colors.success : theme.colors.danger} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{online ? 'Online' : 'Offline'}</Text>
            <Text variant="small" tone="muted">
              {online ? 'Reports upload immediately' : 'Reports are saved on this phone until you reconnect'}
            </Text>
          </View>
          <Badge label={online ? 'Live' : 'Queued'} tone={online ? 'success' : 'warning'} />
        </View>
        <Divider />
        <View style={[styles.statusRow, { padding: theme.spacing.lg, gap: theme.spacing.md }]}>
          <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{pendingCount} unsent report{pendingCount === 1 ? '' : 's'}</Text>
            <Text variant="small" tone="muted">
              Sent automatically when a connection is available
            </Text>
          </View>
          {pendingCount > 0 ? <Button label="Retry" size="sm" variant="soft" loading={flushing} onPress={flush} /> : null}
        </View>
      </Card>

      <Banner
        tone="info"
        icon="lock-closed-outline"
        title="Data on this device"
        message="Only your sign-in token, unsent reports and their photos are stored locally. Case records and child identities are never cached on the phone."
        style={{ marginTop: theme.spacing.xl }}
      />

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
});
