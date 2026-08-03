import React from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { Text } from './Text';

/**
 * Page shell.
 *
 * The app runs edge-to-edge (required from Android 15+), so every screen pads
 * itself from the live safe-area insets rather than assuming a status-bar height.
 */
export function Screen({
  children,
  scroll = true,
  title,
  subtitle,
  headerRight,
  refreshing,
  onRefresh,
  contentStyle,
  footer,
  // Screens rendered inside a navigator header or tab bar opt out of that edge.
  edges = { top: true, bottom: true },
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const padding = {
    paddingTop: edges.top ? insets.top + theme.spacing.sm : theme.spacing.sm,
    paddingBottom: edges.bottom ? insets.bottom + theme.spacing.lg : theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  };

  const header = title ? (
    <View style={[styles.header, { marginBottom: theme.spacing.lg, gap: theme.spacing.md }]}>
      <View style={styles.headerText}>
        <Text variant="display">{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {headerRight}
    </View>
  ) : null;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
        ) : undefined
      }
    >
      {header}
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padding, contentStyle]}>
      {header}
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.md,
              paddingBottom: (edges.bottom ? insets.bottom : 0) + theme.spacing.md,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});

export default Screen;
