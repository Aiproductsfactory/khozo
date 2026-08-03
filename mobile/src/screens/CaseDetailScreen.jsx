import React from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';

import { Badge, Banner, Button, Card, Divider, Screen, SectionHeader, Skeleton, Text } from '../components';
import { useAsync } from '../hooks/useAsync';
import { useProtectedImage } from '../hooks/useProtectedImage';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { formatDate, formatDateTime, initialsOf, joinPlace, relativeTime, statusMeta } from '../utils/format';

function Row({ label, value, icon }) {
  const theme = useTheme();
  if (!value && value !== 0) return null;
  return (
    <View style={[styles.row, { paddingVertical: theme.spacing.sm, gap: theme.spacing.md }]}>
      {icon ? <Ionicons name={icon} size={16} color={theme.colors.textMuted} /> : null}
      <Text variant="small" tone="muted" style={{ width: 108 }}>
        {label}
      </Text>
      <Text variant="smallStrong" style={{ flex: 1 }}>
        {String(value)}
      </Text>
    </View>
  );
}

export default function CaseDetailScreen() {
  const theme = useTheme();
  const { params } = useRoute();
  const { token } = useAuth();
  const reportId = params?.reportId || params?.report?.id;

  const detail = useAsync(
    () => (token && reportId ? officerApi.report(token, reportId).then((r) => r?.report) : Promise.resolve(null)),
    [token, reportId],
  );

  // Show the list row's data immediately, then upgrade to the full record.
  const report = detail.data || params?.report || null;
  // Called before the early returns below so the hook order stays stable.
  const photo = useProtectedImage(report?.photoUrl, token);

  if (detail.loading && !report) {
    return (
      <Screen edges={{ top: false, bottom: true }}>
        <Skeleton height={120} radius={theme.radius.lg} />
        <View style={{ height: theme.spacing.lg }} />
        <Skeleton height={200} radius={theme.radius.lg} />
      </Screen>
    );
  }

  if (!report) {
    return (
      <Screen edges={{ top: false, bottom: true }}>
        <Banner tone="danger" title="Case unavailable" message={detail.error?.message || 'This case could not be loaded.'} />
      </Screen>
    );
  }

  const meta = statusMeta(report.status);
  const workflow = Array.isArray(report.workflow) ? [...report.workflow].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8) : [];

  return (
    <Screen edges={{ top: false, bottom: false }} refreshing={detail.refreshing} onRefresh={detail.refresh}>
      <Card>
        <View style={[styles.head, { gap: theme.spacing.lg }]}>
          {photo.uri ? (
            <Image
              source={{ uri: photo.uri }}
              style={[styles.photo, { borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken }]}
              resizeMode="cover"
              accessibilityLabel={`Photo of ${report.childName}`}
            />
          ) : (
            <View style={[styles.photo, styles.photoEmpty, { borderRadius: theme.radius.md, backgroundColor: theme.colors.primarySoft }]}>
              <Text variant="title" color={theme.colors.primarySoftText}>
                {initialsOf(report.childName)}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text variant="heading" numberOfLines={2}>
              {report.childName}
            </Text>
            <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
              {[report.age != null ? `${report.age} yrs` : null, report.gender].filter(Boolean).join(' · ') || 'Details unavailable'}
            </Text>
            <Badge label={meta.label} tone={meta.tone} style={{ marginTop: theme.spacing.sm }} />
          </View>
        </View>
      </Card>

      <SectionHeader title="Case" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
          <Row icon="pricetag-outline" label="Case ID" value={report.id} />
          <Row icon="document-text-outline" label="FIR" value={report.firNo} />
          <Row icon="location-outline" label="Jurisdiction" value={joinPlace(report.district, report.state)} />
          <Row icon="calendar-outline" label="Missing since" value={report.dateOfMissing ? formatDate(report.dateOfMissing) : null} />
          <Row icon="time-outline" label="Registered" value={formatDateTime(report.createdAt)} />
          <Row icon="person-outline" label="Owner" value={report.assignedToName ? `${report.assignedToName} (${report.assignedToRole})` : null} />
          <Row icon="megaphone-outline" label="Public bulletin" value={report.bulletin?.published ? 'Published' : 'Not published'} />
        </View>
      </Card>

      <SectionHeader title="Guardian" style={{ marginTop: theme.spacing.xl }} />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
          <Row icon="people-outline" label="Name" value={report.parentName} />
          <Row icon="call-outline" label="Phone" value={report.parentPhone} />
          <Row icon="home-outline" label="Address" value={report.address} />
        </View>
        {report.parentPhone ? (
          <>
            <Divider />
            <Button label={`Call ${report.parentPhone}`} variant="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${report.parentPhone}`)} />
          </>
        ) : null}
      </Card>

      {report.identificationProfile && Object.values(report.identificationProfile).some(Boolean) ? (
        <>
          <SectionHeader title="Identification" style={{ marginTop: theme.spacing.xl }} />
          <Card padded={false}>
            <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
              <Row label="Complexion" value={report.identificationProfile.complexion} />
              <Row label="Build" value={report.identificationProfile.build} />
              <Row label="Hair" value={report.identificationProfile.hair} />
              <Row label="Clothing" value={report.identificationProfile.clothing} />
              <Row label="Languages" value={report.identificationProfile.languages} />
              <Row label="Marks" value={report.identificationProfile.identificationMark || report.identificationProfile.birthMark} />
            </View>
          </Card>
        </>
      ) : null}

      {workflow.length ? (
        <>
          <SectionHeader title="Recent activity" style={{ marginTop: theme.spacing.xl }} />
          <Card padded={false}>
            {workflow.map((event, index) => (
              <View key={`${event.ts}-${index}`}>
                {index > 0 ? <Divider /> : null}
                <View style={[styles.event, { padding: theme.spacing.lg, gap: theme.spacing.md }]}>
                  <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text variant="smallStrong">{event.label || event.action}</Text>
                    <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
                      {[event.actorRole, relativeTime(event.ts)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Banner
        tone="info"
        icon="desktop-outline"
        title="Full case workflow is on the dashboard"
        message="Restoration plans, CCI care records, referrals and closures are handled on the Khozo web dashboard, where the full audit trail is available."
        style={{ marginTop: theme.spacing.xl }}
      />

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  photo: { width: 72, height: 72 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  event: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
