import React, { useCallback } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Banner, Button, Card, EmptyState, SectionHeader, Skeleton, Text } from '../components';
import { useAsync } from '../hooks/useAsync';
import { useProtectedImage } from '../hooks/useProtectedImage';
import { officerApi, publicApi } from '../services/api';
import { roleLabel, useAuth } from '../services/auth';
import { HELPLINES } from '../services/config';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';
import { ageBandLabel, joinPlace, relativeTime } from '../utils/format';

/** Big rounded action tile used for the primary journeys. */
function ActionTile({ icon, title, subtitle, onPress, tone = 'primary' }) {
  const theme = useTheme();
  const palette = {
    primary: { bg: theme.colors.primarySoft, fg: theme.colors.primarySoftText },
    danger: { bg: theme.colors.dangerSoft, fg: theme.colors.danger },
    info: { bg: theme.colors.infoSoft, fg: theme.colors.info },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
  }[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          opacity: pressed ? 0.85 : 1,
        },
        theme.shadow.card,
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: palette.bg, borderRadius: theme.radius.md }]}>
        <Ionicons name={icon} size={22} color={palette.fg} />
      </View>
      <Text variant="bodyStrong" style={{ marginTop: theme.spacing.md }}>
        {title}
      </Text>
      <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function HelplineStrip() {
  const theme = useTheme();
  const call = useCallback((number) => {
    Linking.openURL(`tel:${number}`).catch(() => {});
  }, []);

  return (
    <View style={[styles.helplines, { gap: theme.spacing.sm }]}>
      {HELPLINES.map((line) => (
        <Pressable
          key={line.id}
          accessibilityRole="button"
          accessibilityLabel={`Call ${line.label} on ${line.number}`}
          onPress={() => call(line.number)}
          style={({ pressed }) => [
            styles.helpline,
            {
              backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
            },
          ]}
        >
          <Ionicons name="call" size={16} color={theme.colors.danger} />
          <Text variant="heading" style={{ marginTop: 6 }}>
            {line.number}
          </Text>
          <Text variant="small" tone="muted" numberOfLines={1}>
            {line.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function StatTile({ value, label, tone = 'default' }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.spacing.md }]}>
      <Text variant="title" tone={tone}>
        {value}
      </Text>
      <Text variant="small" tone="muted" numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, isSignedIn, canReviewSightings, token } = useAuth();
  const { pendingCount, online } = useOutbox();

  const bulletins = useAsync(() => publicApi.bulletins(), []);
  const officerStats = useAsync(
    () => (canReviewSightings && token ? officerApi.stats(token) : Promise.resolve(null)),
    [canReviewSightings, token],
  );

  const refresh = useCallback(() => {
    bulletins.refresh();
    officerStats.refresh();
  }, [bulletins, officerStats]);

  const stats = officerStats.data?.cards || null;
  const recent = (bulletins.data || []).slice(0, 3);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <LinearGradient
        colors={theme.mode === 'dark' ? ['#1E1B4B', '#0B1020'] : ['#4338CA', '#6D28D9']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + theme.spacing.lg, paddingHorizontal: theme.spacing.lg }]}
      >
        <View style={styles.heroRow}>
          <View style={{ flex: 1 }}>
            {/* Signed out the wordmark stands alone — no tagline above it. */}
            {isSignedIn ? (
              <Text variant="caption" color="rgba(255,255,255,0.72)">
                {roleLabel(user?.role)}
              </Text>
            ) : null}
            <Text variant="display" color="#FFFFFF" style={{ marginTop: isSignedIn ? 4 : 0 }}>
              {isSignedIn ? user?.name?.split(' ')[0] || 'Officer' : 'Khozo'}
            </Text>
            <Text variant="small" color="rgba(255,255,255,0.8)" style={{ marginTop: 4 }}>
              {isSignedIn
                ? [user?.jurisdiction?.district, user?.jurisdiction?.state].filter(Boolean).join(', ') || 'All jurisdictions'
                : 'Report a child you have seen. Help reunite families.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open account"
            onPress={() => navigation.navigate('Account')}
            style={styles.heroAvatar}
          >
            <Ionicons name={isSignedIn ? 'person' : 'person-outline'} size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {!online ? (
          <View style={[styles.offlinePill, { borderRadius: theme.radius.pill, marginTop: theme.spacing.lg }]}>
            <Ionicons name="cloud-offline" size={13} color="#FFFFFF" />
            <Text variant="caption" color="#FFFFFF">
              Offline — reports are saved and sent later
            </Text>
          </View>
        ) : null}
      </LinearGradient>

      <View style={{ flex: 1, marginTop: -theme.spacing.xl }}>
        <ScreenBody refreshing={bulletins.refreshing} onRefresh={refresh} insets={insets}>
          {pendingCount > 0 ? (
            <Banner
              tone="warning"
              icon="cloud-upload-outline"
              title={`${pendingCount} report${pendingCount > 1 ? 's' : ''} waiting to send`}
              message="They are saved on this phone and will upload automatically."
              action={
                <Button
                  label="View unsent reports"
                  variant="ghost"
                  size="sm"
                  onPress={() => navigation.navigate('Outbox')}
                  style={{ alignSelf: 'flex-start', marginTop: theme.spacing.sm, paddingHorizontal: 0 }}
                />
              }
              style={{ marginBottom: theme.spacing.lg }}
            />
          ) : null}

          <View style={[styles.tiles, { gap: theme.spacing.md, marginBottom: theme.spacing.xl }]}>
            <ActionTile
              icon="camera"
              tone="danger"
              title="Report a sighting"
              subtitle="Photo, place and details"
              onPress={() => navigation.navigate('Report')}
            />
            {canReviewSightings ? (
              <ActionTile
                icon="shield-checkmark"
                tone="primary"
                title="Review queue"
                subtitle="Sightings awaiting your decision"
                onPress={() => navigation.navigate('Review')}
              />
            ) : (
              <ActionTile
                icon="megaphone"
                tone="info"
                title="Missing children"
                subtitle="Public bulletins near you"
                onPress={() => navigation.navigate('Bulletins')}
              />
            )}
            <ActionTile
              icon="search"
              tone="info"
              title="Track a case"
              subtitle="Case, FIR or receipt number"
              onPress={() => navigation.navigate('Track')}
            />
            {canReviewSightings ? (
              <ActionTile
                icon="folder-open"
                tone="success"
                title="My cases"
                subtitle="Cases in your jurisdiction"
                onPress={() => navigation.navigate('Cases')}
              />
            ) : (
              <ActionTile
                icon="shield-half"
                tone="success"
                title="Official sign in"
                subtitle="Police, CWC, RPF and partners"
                onPress={() => navigation.navigate(isSignedIn ? 'Account' : 'SignIn')}
              />
            )}
          </View>

          {canReviewSightings && stats ? (
            <>
              <SectionHeader title="Your jurisdiction" />
              <Card style={{ marginBottom: theme.spacing.xl }}>
                <View style={[styles.statRow, { gap: theme.spacing.sm }]}>
                  <StatTile value={stats.activeCases ?? '—'} label="Active cases" tone="danger" />
                  <StatTile value={stats.pendingMatches ?? '—'} label="Sightings pending" tone="warning" />
                  <StatTile value={stats.totalFound ?? '—'} label="Found / closed" tone="success" />
                </View>
                <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.md }}>
                  {officerStats.data?.scope || 'Scoped to your jurisdiction'} · {stats.reunificationRate}% reunification rate
                </Text>
              </Card>
            </>
          ) : null}

          <SectionHeader
            title="Emergency helplines"
            action={
              <Text variant="small" tone="muted">
                Tap to call
              </Text>
            }
          />
          <HelplineStrip />

          <SectionHeader title="Latest public bulletins" style={{ marginTop: theme.spacing.xl }} />
          {bulletins.loading ? (
            <View style={{ gap: theme.spacing.md }}>
              <Skeleton height={64} radius={theme.radius.lg} />
              <Skeleton height={64} radius={theme.radius.lg} />
            </View>
          ) : bulletins.error ? (
            <Banner
              tone="danger"
              title="Could not load bulletins"
              message={bulletins.error.message}
              action={
                <Button label="Retry" size="sm" variant="ghost" onPress={() => bulletins.reload()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
              }
            />
          ) : recent.length === 0 ? (
            <EmptyState
              icon="megaphone-outline"
              title="No active bulletins"
              message="Published missing-child bulletins will appear here."
            />
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {recent.map((item) => (
                <RecentBulletinRow
                  key={item.id}
                  item={item}
                  onPress={() => navigation.navigate('BulletinDetail', { bulletin: item })}
                />
              ))}
              <Button
                label="See all bulletins"
                variant="secondary"
                icon="arrow-forward"
                iconPosition="right"
                onPress={() => navigation.navigate('Bulletins')}
              />
            </View>
          )}
        </ScreenBody>
      </View>
    </View>
  );
}

/** Local scroll body so the hero can sit behind the rounded content sheet. */
function ScreenBody({ children, refreshing, onRefresh, insets }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        borderTopLeftRadius: theme.radius.xl,
        borderTopRightRadius: theme.radius.xl,
      }}
      contentContainerStyle={{
        padding: theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xxl,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
      }
    >
      {children}
    </ScrollView>
  );
}

function RecentBulletinRow({ item, onPress }) {
  const theme = useTheme();
  const photoPath = item.photoUrl || (item.id ? `/api/reports/photo/${item.id}` : null);
  const { uri: imageUri } = useProtectedImage(photoPath, null);

  return (
    <Pressable
      key={item.id}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.bulletinRow,
        {
          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        },
      ]}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={[styles.bulletinAvatar, { borderRadius: theme.radius.md }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.bulletinAvatar, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md }]}>
          <Ionicons name="person" size={20} color={theme.colors.primarySoftText} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.childName}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {ageBandLabel(null, item.age)} · {joinPlace(item.district, item.state)}
        </Text>
      </View>
      <Badge label={relativeTime(item.publishedAt)} tone="neutral" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { flexBasis: '47%', flexGrow: 1, borderWidth: StyleSheet.hairlineWidth },
  tileIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  helplines: { flexDirection: 'row' },
  helpline: { flex: 1, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  statRow: { flexDirection: 'row' },
  stat: { flex: 1, gap: 2 },
  bulletinRow: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  bulletinAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
