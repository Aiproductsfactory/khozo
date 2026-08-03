import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Banner, Button, ChoiceField, EmptyState, SkeletonCard, Text } from '../components';
import { useAsync } from '../hooks/useAsync';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { joinPlace, matchBand, relativeTime, statusMeta } from '../utils/format';

const FILTERS = [
  { label: 'Needs action', value: 'open', clearable: false },
  { label: 'All', value: 'all', clearable: false },
  { label: 'Closed', value: 'closed', clearable: false },
];

const OPEN_STATUSES = new Set(['pending_review', 'no_match', 'referred_cwc']);

function SightingRow({ item, onPress }) {
  const theme = useTheme();
  const meta = statusMeta(item.status);
  const band = matchBand(item.matchScore);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sighting at ${item.foundLocation}, ${meta.label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        },
        theme.shadow.card,
      ]}
    >
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.foundLocation || 'Location not specified'}
          </Text>
          <Text variant="small" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {joinPlace(item.district, item.state)} · {relativeTime(item.createdAt)}
          </Text>
        </View>
        <Badge label={meta.label} tone={meta.tone} />
      </View>

      <View style={[styles.metaRow, { gap: theme.spacing.md }]}>
        <View style={[styles.chip, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.sm, gap: 5 }]}>
          <Ionicons name={item.photoUrl ? 'image' : 'document-text-outline'} size={13} color={theme.colors.textMuted} />
          <Text variant="small" tone="muted">
            {item.photoUrl ? 'Photo' : 'Text only'}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.sm, gap: 5 }]}>
          <Ionicons name="person-outline" size={13} color={theme.colors.textMuted} />
          <Text variant="small" tone="muted">
            {[item.ageApprox != null ? `~${item.ageApprox}y` : null, item.gender].filter(Boolean).join(' ') || 'Unknown'}
          </Text>
        </View>
        {item.matchedReportId ? <Badge label={band.label} tone={band.tone} icon="git-compare-outline" /> : null}
      </View>
    </Pressable>
  );
}

export default function ReviewQueueScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { token, user } = useAuth();
  const [filter, setFilter] = useState('open');

  const queue = useAsync(() => (token ? officerApi.foundReports(token) : Promise.resolve([])), [token]);

  // Coming back from a review decision must show the updated status.
  useFocusEffect(
    useCallback(() => {
      queue.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]),
  );

  const rows = useMemo(() => {
    const all = queue.data || [];
    const sorted = [...all].sort((a, b) => {
      // Strong candidates first, then newest.
      const scoreDiff = (b.matchScore || 0) - (a.matchScore || 0);
      if (Math.abs(scoreDiff) > 0.15) return scoreDiff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    if (filter === 'all') return sorted;
    if (filter === 'closed') return sorted.filter((row) => !OPEN_STATUSES.has(row.status));
    return sorted.filter((row) => OPEN_STATUSES.has(row.status));
  }, [queue.data, filter]);

  const renderItem = useCallback(
    ({ item }) => <SightingRow item={item} onPress={() => navigation.navigate('ReviewDetail', { sighting: item })} />,
    [navigation],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: insets.top + theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
        <Text variant="display">Review queue</Text>
        <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
          Sightings in {[user?.jurisdiction?.district, user?.jurisdiction?.state].filter(Boolean).join(', ') || 'your jurisdiction'}
        </Text>
        <ChoiceField value={filter} options={FILTERS} onChange={(v) => setFilter(v || 'open')} style={{ marginTop: theme.spacing.lg }} />
      </View>

      {queue.loading ? (
        <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : queue.error ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Banner
            tone="danger"
            title="Could not load the queue"
            message={queue.error.message}
            action={<Button label="Retry" size="sm" variant="ghost" onPress={() => queue.reload()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.xxl,
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={queue.refreshing} onRefresh={queue.refresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done-outline"
              title={filter === 'open' ? 'Nothing waiting on you' : 'No sightings here'}
              message={
                filter === 'open'
                  ? 'New sightings in your jurisdiction will appear here for review.'
                  : 'Change the filter to see other sightings.'
              }
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
});
