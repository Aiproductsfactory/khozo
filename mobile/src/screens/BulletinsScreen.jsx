import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Banner, Button, EmptyState, SkeletonCard, Text, TextField } from '../components';
import { useAsync } from '../hooks/useAsync';
import { publicApi } from '../services/api';
import { useTheme } from '../theme';
import { formatDate, initialsOf, joinPlace, relativeTime } from '../utils/format';

function BulletinCard({ item, onPress }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.childName}, ${item.age ?? 'age unknown'}, last seen ${joinPlace(item.district, item.state)}`}
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
      <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md }]}>
        <Text variant="heading" color={theme.colors.primarySoftText}>
          {initialsOf(item.childName)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.childName}
        </Text>
        <Text variant="small" tone="secondary" style={{ marginTop: 2 }} numberOfLines={1}>
          {[item.age != null ? `${item.age} yrs` : 'Age unknown', item.gender].filter(Boolean).join(' · ')}
        </Text>
        <View style={[styles.metaRow, { marginTop: 6, gap: 4 }]}>
          <Ionicons name="location-outline" size={13} color={theme.colors.textMuted} />
          <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {joinPlace(item.district, item.state)}
          </Text>
        </View>
        {item.dateOfMissing ? (
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            Missing since {formatDate(item.dateOfMissing)}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Badge label={relativeTime(item.publishedAt)} tone="neutral" />
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

export default function BulletinsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [search, setSearch] = useState('');

  const bulletins = useAsync(() => publicApi.bulletins(), []);

  const filtered = useMemo(() => {
    const rows = bulletins.data || [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.childName, row.district, row.state, row.agency].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [bulletins.data, search]);

  const renderItem = useCallback(
    ({ item }) => <BulletinCard item={item} onPress={() => navigation.navigate('BulletinDetail', { bulletin: item })} />,
    [navigation],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: insets.top + theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
        <Text variant="display">Missing children</Text>
        <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
          Bulletins published by police and child-protection agencies
        </Text>
        <TextField
          icon="search"
          placeholder="Search by name, district or state"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          style={{ marginTop: theme.spacing.lg }}
        />
      </View>

      {bulletins.loading ? (
        <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : bulletins.error ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Banner
            tone="danger"
            title="Could not load bulletins"
            message={bulletins.error.message}
            action={<Button label="Retry" size="sm" variant="ghost" onPress={() => bulletins.reload()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
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
            <RefreshControl
              refreshing={bulletins.refreshing}
              onRefresh={bulletins.refresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon={search ? 'search-outline' : 'megaphone-outline'}
              title={search ? 'No matching bulletins' : 'No active bulletins'}
              message={
                search
                  ? 'Try a different name, district or state.'
                  : 'Only cases an agency has chosen to publish appear here. Other cases stay restricted to protect the child.'
              }
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
});
