import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Banner, Button, ChoiceField, EmptyState, SkeletonCard, Text, TextField } from '../components';
import { useAsync } from '../hooks/useAsync';
import { officerApi } from '../services/api';
import { useAuth } from '../services/auth';
import { useTheme } from '../theme';
import { initialsOf, joinPlace, relativeTime, statusMeta } from '../utils/format';

const FILTERS = [
  { label: 'All', value: '', clearable: false },
  { label: 'Missing', value: 'missing', clearable: false },
  { label: 'Under review', value: 'under_review', clearable: false },
  { label: 'Found', value: 'found', clearable: false },
];

function CaseRow({ item, onPress }) {
  const theme = useTheme();
  const meta = statusMeta(item.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Case ${item.childName}, ${meta.label}`}
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
        <Text variant="subheading" color={theme.colors.primarySoftText}>
          {initialsOf(item.childName)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.childName}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {[item.age != null ? `${item.age} yrs` : null, item.gender, joinPlace(item.district, item.state)].filter(Boolean).join(' · ')}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {item.firNo ? `${item.firNo} · ` : ''}
          {relativeTime(item.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Badge label={meta.label} tone={meta.tone} />
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

export default function CasesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { token, user } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const cases = useAsync(() => (token ? officerApi.reports(token, { status }) : Promise.resolve([])), [token, status]);

  const rows = useMemo(() => {
    const all = cases.data || [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) =>
      [row.childName, row.firNo, row.parentName, row.district, row.state]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [cases.data, search]);

  const renderItem = useCallback(
    ({ item }) => <CaseRow item={item} onPress={() => navigation.navigate('CaseDetail', { report: item, reportId: item.id })} />,
    [navigation],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: insets.top + theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
        <Text variant="display">Cases</Text>
        <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
          {[user?.jurisdiction?.district, user?.jurisdiction?.state].filter(Boolean).join(', ') || 'All jurisdictions'}
        </Text>
        <TextField
          icon="search"
          placeholder="Search name, FIR or guardian"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          style={{ marginTop: theme.spacing.lg }}
        />
        <ChoiceField value={status} options={FILTERS} onChange={(v) => setStatus(v || '')} style={{ marginTop: theme.spacing.md }} />
      </View>

      {cases.loading ? (
        <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : cases.error ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Banner
            tone="danger"
            title="Could not load cases"
            message={cases.error.message}
            action={<Button label="Retry" size="sm" variant="ghost" onPress={() => cases.reload()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
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
            <RefreshControl refreshing={cases.refreshing} onRefresh={cases.refresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
          }
          ListEmptyComponent={
            <EmptyState icon="folder-open-outline" title="No cases here" message="Cases within your jurisdiction and filter will appear here." />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  avatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
});
