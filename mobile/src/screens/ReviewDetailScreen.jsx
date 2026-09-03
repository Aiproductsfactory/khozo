import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Badge, Banner, Button, Card, Divider, ImageViewerModal, Screen, SectionHeader, Text, TextField } from '../components';
import { useProtectedImage } from '../hooks/useProtectedImage';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { formatDateTime, joinPlace, matchBand, relativeTime, statusMeta } from '../utils/format';

const DECISIONS = [
  {
    value: 'matched',
    label: 'Confirm match',
    icon: 'checkmark-circle',
    variant: 'success',
    requiresConfirmRole: true,
    confirm: 'Confirm this sighting matches the missing-child record? The family and the responsible station will be notified.',
  },
  {
    value: 'refer_cwc',
    label: 'Refer to CWC / 1098',
    icon: 'git-branch-outline',
    variant: 'secondary',
    confirm: 'Refer this sighting to Childline / CWC for welfare follow-up?',
  },
  {
    value: 'rejected',
    label: 'Not a match',
    icon: 'close-circle-outline',
    variant: 'secondary',
    confirm: 'Close this sighting as not a match? It stays in the audit record.',
  },
];

function Row({ label, value, icon }) {
  const theme = useTheme();
  if (!value) return null;
  return (
    <View style={[styles.row, { paddingVertical: theme.spacing.sm, gap: theme.spacing.md }]}>
      {icon ? <Ionicons name={icon} size={16} color={theme.colors.textMuted} /> : null}
      <Text variant="small" tone="muted" style={{ width: 104 }}>
        {label}
      </Text>
      <Text variant="smallStrong" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export default function ReviewDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute();
  const { token, canConfirmMatch } = useAuth();

  const [sighting, setSighting] = useState(params?.sighting || null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // An alert carries an id, not a record, so opening one has to be able to
  // fetch what it points at. Without this, tapping a notification arrived here
  // with nothing to show.
  useEffect(() => {
    if (sighting || !params?.id || !token) return undefined;
    let alive = true;
    officerApi
      .foundReports(token)
      .then((rows) => {
        if (!alive) return;
        const found = rows.find((row) => row.id === params.id);
        if (found) setSighting(found);
        else setLoadError('This sighting is outside your jurisdiction, or has been removed.');
      })
      .catch((error) => {
        if (alive) setLoadError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [sighting, params?.id, token]);

  const submitDecision = useCallback(
    async (decision) => {
      setBusy(decision.value);
      try {
        const result = await officerApi.reviewFound(token, sighting.id, decision.value, note.trim());
        setSighting((prev) => ({ ...prev, ...(result?.foundReport || {}), status: result?.foundReport?.status || prev.status }));
        Alert.alert('Decision recorded', result?.message || 'The review has been saved to the case audit log.', [
          { text: 'Back to queue', onPress: () => navigation.goBack() },
        ]);
      } catch (error) {
        Alert.alert('Could not save the decision', error.message);
      } finally {
        setBusy(null);
      }
    },
    [token, sighting, note, navigation],
  );

  const confirmDecision = useCallback(
    (decision) => {
      Alert.alert(decision.label, decision.confirm, [
        { text: 'Cancel', style: 'cancel' },
        { text: decision.label, onPress: () => submitDecision(decision) },
      ]);
    },
    [submitDecision],
  );

  // Every hook runs before any early return. `useProtectedImage` and
  // `showFullImage` sat below the "no sighting" guard, so a render that took
  // that branch ran fewer hooks than the next one — which React rejects the
  // moment the record arrives asynchronously, as it now does when a
  // notification opens this screen by id.
  const photo = useProtectedImage(sighting?.photoUrl, token);
  const [showFullImage, setShowFullImage] = useState(false);

  if (!sighting) {
    return (
      <Screen edges={{ top: false, bottom: true }}>
        {loadError ? (
          <Banner tone="warning" title="Sighting unavailable" message={loadError} />
        ) : (
          <Banner tone="info" title="Opening sighting" message="Fetching the report this alert points at…" />
        )}
      </Screen>
    );
  }

  const meta = statusMeta(sighting.status);
  const band = matchBand(sighting.matchScore);
  const matched = sighting.matchedReport;
  const decided = !['pending_review', 'no_match', 'referred_cwc'].includes(sighting.status);

  return (
    <Screen edges={{ top: false, bottom: false }}>
      {sighting.photoUrl ? (
        <View style={[styles.photo, styles.photoEmpty, { borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }]}>
          {photo.uri ? (
            <Pressable accessibilityRole="button" accessibilityLabel="View full photo" style={StyleSheet.absoluteFill} onPress={() => setShowFullImage(true)}>
              <Image
                source={{ uri: photo.uri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityLabel="Sighting photo submitted by the reporter"
              />
            </Pressable>
          ) : photo.error ? (
            <>
              <Ionicons name="image-outline" size={28} color={theme.colors.textMuted} />
              <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                Photo could not be loaded
              </Text>
            </>
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
        </View>
      ) : (
        <View style={[styles.photo, styles.photoEmpty, { borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }]}>
          <Ionicons name="document-text-outline" size={28} color={theme.colors.textMuted} />
          <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.sm }}>
            Text-only sighting — no face match was run
          </Text>
        </View>
      )}

      <View style={[styles.headRow, { marginTop: theme.spacing.lg, gap: theme.spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text variant="title">{sighting.foundLocation || 'Location not specified'}</Text>
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            {joinPlace(sighting.district, sighting.state)} · {relativeTime(sighting.createdAt)}
          </Text>
        </View>
        <Badge label={meta.label} tone={meta.tone} />
      </View>

      {sighting.matchedReportId ? (
        <Banner
          tone={band.tone}
          icon="git-compare-outline"
          title={`${band.label} · score ${band.percent}%`}
          message="Scores are an aid, not evidence. Verify identity independently before confirming a match."
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      <SectionHeader title="Sighting" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
          <Row icon="chatbox-outline" label="Note" value={sighting.note} />
          <Row icon="person-outline" label="Child" value={[sighting.ageApprox != null ? `~${sighting.ageApprox} yrs` : null, sighting.gender].filter(Boolean).join(' · ')} />
          <Row icon="navigate-outline" label="GPS" value={sighting.lat != null ? `${sighting.lat}, ${sighting.lng}` : null} />
          <Row icon="time-outline" label="Submitted" value={formatDateTime(sighting.createdAt)} />
          <Row icon="trash-outline" label="Photo until" value={sighting.retentionUntil ? formatDateTime(sighting.retentionUntil) : null} />
        </View>
      </Card>

      <SectionHeader title="Reporter" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
          <Row icon="person-circle-outline" label="Name" value={sighting.reporterName || 'Anonymous citizen'} />
          <Row icon="call-outline" label="Phone" value={sighting.reporterPhoneVisible || (sighting.confidentialReporter ? 'Confidential' : 'Not provided')} />
          <Row icon="card-outline" label="ID proof" value={sighting.idProofLabel ? `${sighting.idProofLabel} ${sighting.idProofNumberMasked || ''}`.trim() : null} />
        </View>
        {sighting.reporterPhoneVisible ? (
          <>
            <Divider />
            <Button
              label={`Call ${sighting.reporterPhoneVisible}`}
              variant="ghost"
              icon="call-outline"
              onPress={() => Linking.openURL(`tel:${sighting.reporterPhoneVisible}`)}
            />
          </>
        ) : null}
      </Card>

      {matched ? (
        <>
          <SectionHeader title="Possible match" style={{ marginTop: theme.spacing.xl }} />
          <Card padded={false}>
            <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
              <Row icon="person-outline" label="Child" value={matched.childName} />
              <Row icon="calendar-outline" label="Age / gender" value={[matched.age != null ? `${matched.age} yrs` : null, matched.gender].filter(Boolean).join(' · ')} />
              <Row icon="location-outline" label="From" value={joinPlace(matched.district, matched.state)} />
              <Row icon="people-outline" label="Guardian" value={matched.parentName} />
              <Row icon="call-outline" label="Guardian no." value={matched.parentPhone} />
            </View>
            <Divider />
            <Button
              label="Open full case"
              variant="ghost"
              icon="open-outline"
              onPress={() => navigation.navigate('CaseDetail', { reportId: matched.id })}
            />
          </Card>
        </>
      ) : null}

      {decided ? (
        <Banner
          tone="success"
          icon="checkmark-done"
          title="Already reviewed"
          message={`This sighting is recorded as "${meta.label}". Further action happens on the Khozo dashboard.`}
          style={{ marginTop: theme.spacing.xl }}
        />
      ) : (
        <>
          <SectionHeader title="Your decision" style={{ marginTop: theme.spacing.xl }} />
          <TextField
            label="Review note"
            placeholder="What did you verify? Who did you contact?"
            value={note}
            onChangeText={setNote}
            multiline
            // The /found/:id/review endpoint does not persist a note yet, so this
            // must not promise a durable record. The decision itself is audited.
            hint="Your decision is recorded in the audit log against your name and role."
          />
          <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
            {DECISIONS.map((decision) => {
              const blocked = decision.requiresConfirmRole && !canConfirmMatch;
              if (blocked) return null;
              return (
                <Button
                  key={decision.value}
                  label={decision.label}
                  icon={decision.icon}
                  variant={decision.variant}
                  loading={busy === decision.value}
                  disabled={Boolean(busy) && busy !== decision.value}
                  onPress={() => confirmDecision(decision)}
                  fullWidth
                />
              );
            })}
          </View>
          {!canConfirmMatch ? (
            <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.md, textAlign: 'center' }}>
              Only police and command roles can confirm a reunification match.
            </Text>
          ) : null}
        </>
      )}

      <View style={{ height: theme.spacing.xxl }} />
      <ImageViewerModal
        visible={showFullImage}
        imageUri={photo.uri}
        title={sighting.foundLocation || 'Sighting Photo'}
        onClose={() => setShowFullImage(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 260 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
