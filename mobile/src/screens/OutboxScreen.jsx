import React, { useCallback } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Banner, Button, Card, EmptyState, Screen, Text } from '../components';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';
import { relativeTime } from '../utils/format';

function QueuedItem({ item, onDiscard }) {
  const theme = useTheme();
  const payload = item.payload || {};
  const blocked = Boolean(item.permanentError);

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <View style={[styles.head, { gap: theme.spacing.md }]}>
        {payload.photoUri ? (
          <Image source={{ uri: payload.photoUri }} style={[styles.thumb, { borderRadius: theme.radius.md }]} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md }]}>
            <Ionicons name="document-text-outline" size={22} color={theme.colors.textMuted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {payload.foundLocation || 'Location not specified'}
          </Text>
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            Saved {relativeTime(item.createdAt)}
            {item.attempts > 0 ? ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'}` : ''}
          </Text>
          <Badge
            label={blocked ? 'Needs attention' : 'Waiting to send'}
            tone={blocked ? 'danger' : 'warning'}
            style={{ marginTop: theme.spacing.sm }}
          />
        </View>
      </View>

      {payload.note ? (
        <Text variant="small" tone="secondary" numberOfLines={3}>
          {payload.note}
        </Text>
      ) : null}

      {blocked ? (
        <Banner
          tone="danger"
          title="The server rejected this report"
          message={`${item.permanentError} It will not be retried automatically.`}
        />
      ) : item.lastError ? (
        <Text variant="small" tone="muted">
          Last attempt: {item.lastError}
        </Text>
      ) : null}

      <Button label="Discard report" variant="ghost" size="sm" icon="trash-outline" onPress={() => onDiscard(item)} style={{ alignSelf: 'flex-start' }} />
    </Card>
  );
}

export default function OutboxScreen() {
  const theme = useTheme();
  const { items, pendingCount, blockedCount, online, flush, flushing, discard, lastResult } = useOutbox();

  const confirmDiscard = useCallback(
    (item) => {
      Alert.alert('Discard this report?', 'It will be deleted from this phone and never sent. This cannot be undone.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => discard(item.id) },
      ]);
    },
    [discard],
  );

  return (
    <Screen
      edges={{ top: false, bottom: false }}
      refreshing={flushing}
      onRefresh={flush}
      footer={
        items.length > 0 ? (
          <Button
            label={online ? 'Try sending now' : 'Waiting for a connection'}
            icon="cloud-upload-outline"
            loading={flushing}
            disabled={!online || pendingCount === 0}
            onPress={flush}
            fullWidth
          />
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title="Everything has been sent"
          message="Reports you submit without a connection are saved here until they upload."
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Banner
            tone={online ? 'info' : 'warning'}
            icon={online ? 'cloud-upload-outline' : 'cloud-offline'}
            title={`${pendingCount} waiting${blockedCount ? ` · ${blockedCount} need attention` : ''}`}
            message={
              online
                ? 'Khozo retries automatically whenever the app opens or the connection returns.'
                : 'You are offline. Reports stay safely on this phone until you reconnect.'
            }
          />

          {lastResult ? (
            <Text variant="small" tone="muted">
              Last attempt {relativeTime(lastResult.at)}: {lastResult.sent} sent, {lastResult.failed} failed.
            </Text>
          ) : null}

          {items.map((item) => (
            <QueuedItem key={item.id} item={item} onDiscard={confirmDiscard} />
          ))}
        </View>
      )}

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  thumb: { width: 64, height: 64 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
});
