import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { Badge, Banner, Button, Card, ChoiceField, Divider, EmptyState, Screen, SectionHeader, Text, TextField } from '../components';
import { ApiError, publicApi } from '../services/api';
import { loadReceipts } from '../services/queue';
import { useTheme } from '../theme';
import { formatDateTime, relativeTime, statusMeta } from '../utils/format';

const LOOKUP_TYPES = [
  { label: 'Sighting receipt', value: 'sighting', clearable: false },
  { label: 'Case / FIR', value: 'case', clearable: false },
];

function ResultRow({ label, value }) {
  const theme = useTheme();
  if (!value) return null;
  return (
    <View style={[styles.row, { paddingVertical: theme.spacing.sm, gap: theme.spacing.md }]}>
      <Text variant="small" tone="muted" style={{ width: 110 }}>
        {label}
      </Text>
      <Text variant="smallStrong" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export default function TrackScreen() {
  const theme = useTheme();
  const [type, setType] = useState('sighting');
  const [ref, setRef] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [receipts, setReceipts] = useState([]);

  const refreshReceipts = useCallback(() => {
    loadReceipts().then(setReceipts);
  }, []);

  useEffect(refreshReceipts, [refreshReceipts]);
  useFocusEffect(refreshReceipts);

  const lookup = useCallback(
    async (value = ref, lookupType = type) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) {
        setError('Enter a reference number to look up');
        return;
      }
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const data = lookupType === 'sighting' ? await publicApi.sightingStatus(trimmed) : await publicApi.caseStatus(trimmed);
        setResult({ ...data, lookupType });
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'No record found for that reference. Check the number and try again.'
            : err.message,
        );
      } finally {
        setLoading(false);
      }
    },
    [ref, type],
  );

  const meta = result ? statusMeta(result.status) : null;

  return (
    <Screen title="Track a case" subtitle="Check the status of a report you made" edges={{ top: true, bottom: false }}>
      <ChoiceField label="What are you looking up?" value={type} options={LOOKUP_TYPES} onChange={(v) => setType(v || 'sighting')} />

      <TextField
        label="Reference number"
        icon="key-outline"
        placeholder={type === 'sighting' ? 'e.g. f_A1b2C3d4' : 'Case ID, FIR number or external ID'}
        value={ref}
        onChangeText={setRef}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => lookup()}
        style={{ marginTop: theme.spacing.lg }}
      />

      <Button label="Look up" icon="search" onPress={() => lookup()} loading={loading} fullWidth style={{ marginTop: theme.spacing.lg }} />

      {error ? <Banner tone="danger" title="Not found" message={error} style={{ marginTop: theme.spacing.lg }} /> : null}

      {result ? (
        <Card style={{ marginTop: theme.spacing.lg }}>
          <View style={[styles.resultHead, { gap: theme.spacing.md }]}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="muted">
                {result.lookupType === 'sighting' ? 'Sighting' : 'Case'} {result.id}
              </Text>
              <Text variant="heading" style={{ marginTop: 4 }}>
                {result.statusLabel || meta?.label}
              </Text>
            </View>
            {meta ? <Badge label={meta.label} tone={meta.tone} /> : null}
          </View>

          <Text variant="small" tone="secondary" style={{ marginTop: theme.spacing.md }}>
            {result.message}
          </Text>

          <Divider style={{ marginVertical: theme.spacing.md }} />

          {result.lookupType === 'sighting' ? (
            <>
              <ResultRow label="Reported at" value={result.foundLocation} />
              <ResultRow label="Submitted" value={formatDateTime(result.submittedAt)} />
              <ResultRow label="Referral" value={result.referralStatus} />
              <ResultRow label="Childline 1098" value={result.referredTo1098 ? 'Notified' : null} />
            </>
          ) : (
            <>
              <ResultRow label="Child" value={result.publicName} />
              <ResultRow label="Age band" value={result.ageBand ? `${result.ageBand} yrs` : null} />
              <ResultRow label="District" value={[result.district, result.state].filter(Boolean).join(', ')} />
              <ResultRow label="FIR" value={result.firNo} />
              <ResultRow label="Registered" value={formatDateTime(result.registeredAt)} />
              <ResultRow label="Stage" value={result.workflowStage} />
              <ResultRow label="Closure" value={result.closureReason} />
            </>
          )}

          <Banner tone="info" icon="information-circle" message={result.nextStep} style={{ marginTop: theme.spacing.md }} />
        </Card>
      ) : null}

      <SectionHeader title="Reports from this phone" style={{ marginTop: theme.spacing.xxl }} />
      {receipts.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No reports yet"
          message="Sightings you submit from this phone will be listed here with their receipt numbers."
        />
      ) : (
        <Card padded={false}>
          {receipts.map((receipt, index) => {
            const receiptMeta = statusMeta(receipt.status);
            return (
              <View key={receipt.id}>
                {index > 0 ? <Divider /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Look up sighting ${receipt.id}`}
                  onPress={() => {
                    setType('sighting');
                    setRef(receipt.id);
                    lookup(receipt.id, 'sighting');
                  }}
                  style={({ pressed }) => [
                    styles.receipt,
                    { padding: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent' },
                  ]}
                >
                  <Ionicons name="receipt-outline" size={20} color={theme.colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text variant="smallStrong">{receipt.id}</Text>
                    <Text variant="small" tone="muted" numberOfLines={1}>
                      {receipt.foundLocation || 'Location not specified'} · {relativeTime(receipt.submittedAt)}
                    </Text>
                  </View>
                  <Badge label={receiptMeta.label} tone={receiptMeta.tone} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  resultHead: { flexDirection: 'row', alignItems: 'flex-start' },
  receipt: { flexDirection: 'row', alignItems: 'center' },
});
