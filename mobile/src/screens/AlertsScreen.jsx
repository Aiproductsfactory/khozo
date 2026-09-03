import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Card, Screen, SectionHeader, Text } from '../components';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { relativeTime } from '../utils/format';

const POLL_MS = 20000;

/**
 * Alerts for the signed-in officer.
 *
 * Every authority account is notified the moment a child is reported spotted,
 * so this is the screen that turns a citizen's report into someone's next
 * action. It refreshes on focus and while open, which is what an officer with
 * the app in their hand needs; delivery to a locked phone needs a push
 * credential (FCM) that the project does not yet hold.
 *
 * An alert carries where and when. Opening the sighting behind it goes through
 * the same jurisdiction rules as everything else, so being told a child was
 * seen does not grant access to that child's record.
 */
export default function AlertsScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await officerApi.notifications(token);
      setItems(data.notifications || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Opening the screen is the officer acknowledging the alerts, so the badge
  // clears here rather than needing a separate action.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await load();
        if (!alive || !token) return;
        await officerApi.markNotificationsRead(token).catch(() => {});
      })();
      return () => {
        alive = false;
      };
    }, [load, token]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const open = useCallback(
    (item) => {
      if (item.scope?.foundReportId) {
        navigation.navigate('ReviewDetail', { id: item.scope.foundReportId });
      }
    },
    [navigation],
  );

  const renderItem = ({ item }) => (
    <Pressable
      onPress={item.scope?.foundReportId ? () => open(item) : undefined}
      style={({ pressed }) => ({ opacity: pressed && item.scope?.foundReportId ? 0.7 : 1 })}
    >
      <Card padded style={{ marginBottom: theme.spacing.md }}>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Ionicons
            name={item.priority === 'high' ? 'alert-circle' : 'notifications'}
            size={22}
            color={item.priority === 'high' ? theme.colors.danger : theme.colors.primary}
          />
          <View style={{ flex: 1 }}>
            <View style={[styles.row, { justifyContent: 'space-between', gap: theme.spacing.sm }]}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>{item.title}</Text>
              {!item.readAt ? <Badge label="New" tone="danger" /> : null}
            </View>
            <Text variant="small" tone="muted" style={{ marginTop: 2 }}>{item.body}</Text>
            <View style={[styles.row, { marginTop: theme.spacing.sm, gap: theme.spacing.sm }]}>
              <Text variant="caption" tone="muted">{relativeTime(item.ts)}</Text>
              {item.inJurisdiction ? <Badge label="Your jurisdiction" tone="info" /> : null}
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );

  return (
    <Screen edges={{ top: false, bottom: false }} scroll={false}>
      <SectionHeader title="EVERY SIGHTING REPORTED ACROSS THE NETWORK" />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        ListEmptyComponent={
          loading ? null : (
            <Card padded>
              <Text variant="bodyStrong">{error ? 'Could not load alerts' : 'No alerts yet'}</Text>
              <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
                {error || 'You will be alerted here the moment a child is reported spotted.'}
              </Text>
            </Card>
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
