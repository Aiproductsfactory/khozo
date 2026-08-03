import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { toneColors, useTheme } from '../theme';
import { Text } from './Text';

/** Standard elevated container. */
export function Card({ children, padded = true, style, ...rest }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: padded ? theme.spacing.lg : 0,
        },
        theme.shadow.card,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/** Small status pill, e.g. "Under review", "Matched". */
export function Badge({ label, tone = 'neutral', icon, style }) {
  const theme = useTheme();
  const { fg, bg } = toneColors(theme, tone);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderRadius: theme.radius.pill, gap: icon ? 4 : 0 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text variant="caption" color={fg}>
        {label}
      </Text>
    </View>
  );
}

/** Inline explanatory message. Use for privacy notes, offline state, errors. */
export function Banner({ tone = 'info', icon, title, message, action, style }) {
  const theme = useTheme();
  const { fg, bg } = toneColors(theme, tone);
  const defaultIcon = { info: 'information-circle', success: 'checkmark-circle', warning: 'warning', danger: 'alert-circle' }[tone];
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: bg, borderRadius: theme.radius.md, padding: theme.spacing.md, gap: theme.spacing.md },
        style,
      ]}
    >
      <Ionicons name={icon || defaultIcon || 'information-circle'} size={20} color={fg} style={styles.bannerIcon} />
      <View style={styles.bannerBody}>
        {title ? (
          <Text variant="smallStrong" color={fg}>
            {title}
          </Text>
        ) : null}
        {message ? (
          <Text variant="small" tone="secondary" style={title ? { marginTop: 2 } : null}>
            {message}
          </Text>
        ) : null}
        {action}
      </View>
    </View>
  );
}

/** Row used in lists and settings. Becomes tappable when `onPress` is given. */
export function ListRow({ icon, iconTone = 'primary', title, subtitle, right, onPress, style, ...rest }) {
  const theme = useTheme();
  const { fg, bg } = toneColors(theme, iconTone);
  // A plain View ignores a function style, which would silently drop the row
  // layout, so the pressed-state variant is only used for Pressable.
  const baseStyle = [styles.row, { padding: theme.spacing.lg, gap: theme.spacing.md }, style];

  const content = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: bg, borderRadius: theme.radius.md }]}>
          <Ionicons name={icon} size={20} color={fg} />
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? right : onPress ? <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={baseStyle} {...rest}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [...baseStyle, pressed && { backgroundColor: theme.colors.surfaceSunken }]}
      {...rest}
    >
      {content}
    </Pressable>
  );
}

/** Hairline divider that respects the theme. */
export function Divider({ style }) {
  const theme = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }, style]} />;
}

/** Section header with an optional trailing action. */
export function SectionHeader({ title, action, style }) {
  const theme = useTheme();
  return (
    <View style={[styles.sectionHeader, { marginBottom: theme.spacing.md }, style]}>
      <Text variant="caption" tone="muted">
        {title}
      </Text>
      {action}
    </View>
  );
}

/** Placeholder for empty lists and unavailable data. */
export function EmptyState({ icon = 'file-tray-outline', title, message, action, style }) {
  const theme = useTheme();
  return (
    <View style={[styles.empty, { padding: theme.spacing.xxl, gap: theme.spacing.sm }, style]}>
      <View
        style={[
          styles.emptyIcon,
          { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.pill, marginBottom: theme.spacing.sm },
        ]}
      >
        <Ionicons name={icon} size={26} color={theme.colors.textMuted} />
      </View>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: theme.spacing.md }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start' },
  banner: { flexDirection: 'row', alignItems: 'flex-start' },
  bannerIcon: { marginTop: 1 },
  bannerBody: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
