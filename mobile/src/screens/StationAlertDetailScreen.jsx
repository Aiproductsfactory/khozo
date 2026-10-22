import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';

import { Badge, Banner, Button, Card, Divider, ImageViewerModal, Screen, SectionHeader, Text, TextField } from '../components';
import { useProtectedImage } from '../hooks/useProtectedImage';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { formatDateTime, relativeTime } from '../utils/format';
import {
  CONCERN_LABELS, OUTCOME_LABELS, answeredBy, careInstruction, mapsUrl, placeOf, reasonLine, whoWasSeen,
} from '../utils/stationAlerts';

function Row({ icon, label, value }) {
  const theme = useTheme();
  if (!value) return null;
  return (
    <View style={[styles.row, { gap: theme.spacing.md, paddingVertical: theme.spacing.sm }]}>
      <Ionicons name={icon} size={16} color={theme.colors.textMuted} style={{ marginTop: 2 }} />
      <Text variant="small" tone="muted" style={{ width: 92 }}>
        {label}
      </Text>
      <Text variant="small" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A sighting sent to this officer's station: where to go, the photo, and the
 * answer. "On it" first, because it is what stops the alert going to the
 * control room (15 minutes, shared/station-alerts.js); then what happened.
 * The station never sees the case the sighting may match.
 */
export default function StationAlertDetailScreen() {
  const theme = useTheme();
  const { params } = useRoute();
  const { token, user } = useAuth();
  const [alert, setAlert] = useState(params?.alert || null);
  const [loadError, setLoadError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [showFullImage, setShowFullImage] = useState(false);

  // A notification carries an id, not the record.
  useEffect(() => {
    if (alert || !params?.id || !token) return undefined;
    let alive = true;
    officerApi
      .stationAlerts(token)
      .then((rows) => {
        if (!alive) return;
        const found = rows.find((row) => row.id === params.id);
        if (found) setAlert(found);
        else setLoadError('This sighting was not sent to your station, or it has been closed and removed.');
      })
      .catch((error) => {
        if (alive) setLoadError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [alert, params?.id, token]);

  const send = useCallback(
    async (outcome) => {
      if (outcome === 'update' && !note.trim()) {
        Alert.alert('Write the update', 'Say what has happened, then send it.');
        return;
      }
      setBusy(outcome);
      try {
        const updated = await officerApi.stationAlertReply(token, alert.id, outcome, note.trim() || undefined);
        if (updated) setAlert(updated);
        if (outcome !== 'on_it') setNote('');
      } catch (error) {
        Alert.alert('Could not send your answer', error.message);
      } finally {
        setBusy(null);
      }
    },
    [token, alert, note],
  );

  const confirmThen = useCallback(
    (outcome) => {
      Alert.alert(OUTCOME_LABELS[outcome], 'Send this to everyone told about the sighting?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => send(outcome) },
      ]);
    },
    [send],
  );

  // Every hook runs before the early return below.
  const photo = useProtectedImage(alert?.photoUrl, token);

  if (!alert) {
    return (
      <Screen edges={{ top: false, bottom: true }}>
        {loadError ? (
          <Banner tone="warning" title="Sighting unavailable" message={loadError} />
        ) : (
          <Banner tone="info" title="Opening sighting" message="Fetching the sighting this alert points at…" />
        )}
      </Screen>
    );
  }

  const sa = alert.stationAlert || {};
  const open = alert.status === 'open';
  const iAnswered = answeredBy(alert, user);
  const directions = mapsUrl(alert);
  const replies = [...(sa.replies || [])].sort((a, b) => (b.at || 0) - (a.at || 0));

  return (
    <Screen edges={{ top: false, bottom: false }}>
      {!open ? (
        <Banner tone="info" icon="lock-closed-outline" title="Closed" message="This sighting has been decided or closed. You can still add what you found." style={{ marginBottom: theme.spacing.lg }} />
      ) : null}

      <Text variant="title">
        {whoWasSeen(alert)} seen near {placeOf(alert)}
      </Text>
      <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
        {formatDateTime(alert.createdAt)} ({relativeTime(alert.createdAt)}) · {reasonLine(alert)}
      </Text>
      {alert.lat != null ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
          {Number(alert.lat).toFixed(5)}, {Number(alert.lng).toFixed(5)}
        </Text>
      ) : null}

      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
        {directions ? (
          <Button label="Open in Maps" icon="navigate" size="lg" onPress={() => Linking.openURL(directions)} fullWidth />
        ) : null}
        <Button
          label={iAnswered ? 'You have answered' : 'On it'}
          icon="hand-left"
          size="lg"
          variant="danger"
          loading={busy === 'on_it'}
          disabled={iAnswered || !open || Boolean(busy)}
          onPress={() => send('on_it')}
          fullWidth
        />
      </View>

      {sa.ack ? (
        <Banner
          tone="success"
          icon="checkmark-circle"
          title={`${OUTCOME_LABELS[sa.ack.outcome] || 'Answered'}: ${sa.ack.byName}${sa.ack.desk ? `, ${sa.ack.desk}` : ''}`}
          message={`First answer, ${relativeTime(sa.ack.at)}.${sa.ack.byPhone ? ` Phone ${sa.ack.byPhone}.` : ''}`}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : open ? (
        <Banner
          tone="danger"
          icon="time-outline"
          title="Nobody has answered yet"
          message={
            sa.escalatedAt
              ? 'No station answered in time, so the control room and the command centre have been told too.'
              : 'Tap "On it" when you are sending someone. If no station answers within 15 minutes, the control room is told.'
          }
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      <Banner tone="warning" icon="heart-outline" title="When you get there" message={careInstruction(alert)} style={{ marginTop: theme.spacing.lg }} />

      {alert.photoUrl ? (
        <View style={[styles.photo, styles.centred, { marginTop: theme.spacing.xl, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }]}>
          {photo.uri ? (
            <Pressable accessibilityRole="button" accessibilityLabel="View full photo" style={StyleSheet.absoluteFill} onPress={() => setShowFullImage(true)}>
              <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Photo sent by the reporter" />
            </Pressable>
          ) : photo.error ? (
            <Text variant="small" tone="muted">
              Photo could not be loaded
            </Text>
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
        </View>
      ) : null}

      <SectionHeader title="What the reporter said" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
          <Row icon="chatbox-outline" label="Note" value={alert.note} />
          <Row icon="help-buoy-outline" label="Why worried" value={CONCERN_LABELS[alert.concernReason] || null} />
          <Row
            icon="person-outline"
            label="Seen"
            value={[whoWasSeen(alert), alert.ageApprox != null ? `about ${alert.ageApprox} years` : null, alert.gender].filter(Boolean).join(' · ')}
          />
          <Row icon="location-outline" label="Typed place" value={alert.foundLocation && alert.foundLocation !== placeOf(alert) ? alert.foundLocation : null} />
          <Row icon="pricetag-outline" label="Poster code" value={sa.posterCode} />
          <Row icon="person-circle-outline" label="Reporter" value={alert.reporterName || 'Anonymous'} />
        </View>
        {alert.reporterPhone ? (
          <>
            <Divider />
            <Button label={`Call reporter ${alert.reporterPhone}`} variant="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${alert.reporterPhone}`)} />
          </>
        ) : null}
      </Card>

      <SectionHeader title="Report back" style={{ marginTop: theme.spacing.xl }} />
      <TextField
        label="Note (needed for an update)"
        placeholder="What did you find? Who is with the person now?"
        value={note}
        onChangeText={setNote}
        multiline
        hint="Everyone told about this sighting sees your answer, with your name and phone."
      />
      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
        <Button label="Found the person" icon="checkmark-circle-outline" variant="success" loading={busy === 'found'} disabled={Boolean(busy)} onPress={() => confirmThen('found')} fullWidth />
        <Button label="Not there" icon="close-circle-outline" variant="secondary" loading={busy === 'not_found'} disabled={Boolean(busy)} onPress={() => confirmThen('not_found')} fullWidth />
        <Button label="Send an update" icon="chatbubble-ellipses-outline" variant="soft" loading={busy === 'update'} disabled={Boolean(busy)} onPress={() => send('update')} fullWidth />
      </View>

      {replies.length ? (
        <>
          <SectionHeader title="Answers" style={{ marginTop: theme.spacing.xl }} />
          <Card padded={false}>
            {replies.map((reply, i) => (
              <View key={`${reply.at}-${i}`}>
                {i ? <Divider /> : null}
                <View style={{ padding: theme.spacing.lg, gap: 2 }}>
                  <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'center' }]}>
                    <Badge label={OUTCOME_LABELS[reply.outcome] || 'Update'} tone={reply.outcome === 'found' ? 'success' : reply.outcome === 'on_it' ? 'primary' : 'neutral'} />
                    <Text variant="caption" tone="muted">
                      {relativeTime(reply.at)}
                    </Text>
                  </View>
                  {reply.note ? <Text variant="small">{reply.note}</Text> : null}
                  <Text variant="small" tone="muted">
                    {[reply.byName, reply.desk, reply.byPhone].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <View style={{ height: theme.spacing.xxl }} />
      <ImageViewerModal visible={showFullImage} imageUri={photo.uri} title={placeOf(alert)} onClose={() => setShowFullImage(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 260 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
