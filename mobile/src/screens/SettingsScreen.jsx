import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Banner, Button, Card, Divider, Screen, SectionHeader, Text, TextField } from '../components';
import { checkHealth } from '../services/api';
import { DEFAULT_API_URL, getApiBaseUrl, resetApiBaseUrl, setApiBaseUrl } from '../services/config';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const { online, pendingCount, flush, flushing } = useOutbox();

  const [url, setUrl] = useState(getApiBaseUrl());
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState(null);
  const [testing, setTesting] = useState(false);

  const save = useCallback(async () => {
    setError(null);
    setSaved(false);
    setProbe(null);
    try {
      const next = await setApiBaseUrl(url);
      setUrl(next);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }, [url]);

  const reset = useCallback(async () => {
    const next = await resetApiBaseUrl();
    setUrl(next);
    setSaved(true);
    setError(null);
    setProbe(null);
  }, []);

  const test = useCallback(async () => {
    setTesting(true);
    setProbe(null);
    try {
      // Persist first so the probe hits the address shown in the field.
      await setApiBaseUrl(url).catch(() => {});
      const result = await checkHealth();
      setProbe({ ok: result.ok, message: `Connected to ${result.service || 'khozo-api'} in ${result.latencyMs} ms` });
    } catch (err) {
      setProbe({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }, [url]);

  return (
    <Screen edges={{ top: false, bottom: false }}>
      <SectionHeader title="Khozo server" />
      <Card style={{ gap: theme.spacing.lg }}>
        <TextField
          label="Server address"
          icon="server-outline"
          placeholder="http://192.168.0.151:4000"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setSaved(false);
            setProbe(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={error}
          hint="Use the address of the machine running the Khozo API. A phone cannot reach 'localhost' on your computer."
        />

        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Button label="Test connection" variant="secondary" icon="pulse-outline" loading={testing} onPress={test} style={{ flex: 1 }} />
          <Button label="Save" icon="checkmark" onPress={save} style={{ flex: 1 }} />
        </View>

        {probe ? <Banner tone={probe.ok ? 'success' : 'danger'} title={probe.ok ? 'Server reachable' : 'Could not connect'} message={probe.message} /> : null}
        {saved && !probe ? <Banner tone="success" title="Saved" message={`Requests now go to ${getApiBaseUrl()}`} /> : null}

        <Button label="Reset to default" variant="ghost" size="sm" onPress={reset} style={{ alignSelf: 'flex-start' }} />
        <Text variant="small" tone="muted">
          Default: {DEFAULT_API_URL}
        </Text>
      </Card>

      <SectionHeader title="Connection" style={{ marginTop: theme.spacing.xl }} />
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
