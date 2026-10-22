import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Badge, Banner, Button, EmptyState, SectionHeader, SkeletonCard, Text } from '../components';
import { useAsync } from '../hooks/useAsync';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { relativeTime } from '../utils/format';
import { OUTCOME_LABELS, needsAnswer, placeOf, reasonLine, whoWasSeen } from '../utils/stationAlerts';

/** Unanswered first, then open, then newest. */
function ordered(alerts) {
  const rank = (a) => (needsAnswer(a) ? 0 : a.status === 'open' ? 1 : 2);
  return [...(alerts || [])].sort((a, b) => rank(a) - rank(b) || (b.stationAlert?.sentAt || 0) - (a.stationAlert?.sentAt || 0));
}

/** One sighting sent to the station. Red until someone has said "On it". */
export function StationAlertCard({ alert, onPress }) {
  const theme = useTheme();
  const waiting = needsAnswer(alert);
  const ack = alert.stationAlert?.ack;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${whoWasSeen(alert)} seen near ${placeOf(alert)}${waiting ? ', nobody has answered yet' : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
          borderColor: waiting ? theme.colors.danger : theme.colors.border,
          borderWidth: waiting ? 2 : StyleSheet.hairlineWidth,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
        theme.shadow.card,
      ]}
    >
      <View style={[styles.head, { gap: theme.spacing.md }]}>
        <Ionicons name={waiting ? 'alert-circle' : 'location'} size={22} color={waiting ? theme.colors.danger : theme.colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {whoWasSeen(alert)} seen near {placeOf(alert)}
          </Text>
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            {relativeTime(alert.stationAlert?.sentAt || alert.createdAt)} · {reasonLine(alert)}
          </Text>
        </View>
        {waiting ? (
          <Badge label="Needs an answer" tone="danger" />
        ) : alert.status === 'open' ? (
          <Badge label="Open" tone="warning" />
        ) : (
          <Badge label="Closed" tone="neutral" />
        )}
      </View>
      {ack ? (
        <Text variant="small" tone="secondary">
          {OUTCOME_LABELS[ack.outcome] || 'Answered'}: {ack.byName}
          {ack.desk ? `, ${ack.desk}` : ''} · {relativeTime(ack.at)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The top of the Review queue for a police officer: sightings sent to their
 * station that are still open, so the one waiting for an answer is the first
 * thing they see.
 */
export function StationAlertsSection() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { token, canAnswerStationAlerts } = useAuth();
  const list = useAsync(
    () => (token && canAnswerStationAlerts ? officerApi.stationAlerts(token) : Promise.resolve([])),
    [token, canAnswerStationAlerts],
  );

  useFocusEffect(
    useCallback(() => {
      list.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]),
  );

  const open = useMemo(() => ordered(list.data).filter((a) => a.status === 'open'), [list.data]);
  if (!canAnswerStationAlerts || (!open.length && !list.error)) return null;
  const waiting = open.filter(needsAnswer).length;

  return (
    <View style={{ marginBottom: theme.spacing.lg, gap: theme.spacing.md }}>
      <SectionHeader
        title={waiting ? `SENT TO YOUR STATION · ${waiting} NEED AN ANSWER` : 'SENT TO YOUR STATION'}
        action={
          <Button label="See all" size="sm" variant="ghost" onPress={() => navigation.navigate('StationAlerts')} style={{ paddingHorizontal: 0 }} />
        }
      />
      {list.error ? (
        <Banner tone="warning" title="Could not load sightings sent to your station" message={list.error.message} />
      ) : (
        open.slice(0, 3).map((alert) => (
          <StationAlertCard key={alert.id} alert={alert} onPress={() => navigation.navigate('StationAlertDetail', { alert })} />
        ))
      )}
      {open.length > 3 ? (
        <Text variant="small" tone="muted">
          {open.length - 3} more open. Tap "See all".
        </Text>
      ) : null}
    </View>
  );
}

/** Every sighting sent to this station (or, escalated, to its control room) in the last 30 days. */
export default function StationAlertsScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { token } = useAuth();
  const list = useAsync(() => (token ? officerApi.stationAlerts(token) : Promise.resolve([])), [token]);

  // Coming back from an answer must show it.
  useFocusEffect(
    useCallback(() => {
      list.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]),
  );

  const rows = useMemo(() => ordered(list.data), [list.data]);

  if (list.loading) {
    return (
      <View style={{ flex: 1, padding: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background }}>
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {list.error ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Banner
            tone="danger"
            title="Could not load sightings sent to your station"
            message={list.error.message}
            action={<Button label="Retry" size="sm" variant="ghost" onPress={() => list.reload()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
          />
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StationAlertCard alert={item} onPress={() => navigation.navigate('StationAlertDetail', { alert: item })} />}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="shield-checkmark-outline"
            title="Nothing sent to your station"
            message="A sighting reported near your station, or through your posters, appears here and rings this phone."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  head: { flexDirection: 'row', alignItems: 'flex-start' },
});
