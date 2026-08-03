import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme';
import { Text } from './Text';

const SIZES = {
  sm: { paddingV: 8, paddingH: 14, gap: 6, icon: 16, variant: 'smallStrong', minHeight: 36 },
  md: { paddingV: 13, paddingH: 18, gap: 8, icon: 18, variant: 'bodyStrong', minHeight: 48 },
  lg: { paddingV: 17, paddingH: 22, gap: 10, icon: 20, variant: 'subheading', minHeight: 56 },
};

function paletteFor(theme, variant, disabled) {
  const c = theme.colors;
  const map = {
    primary: { bg: c.primary, pressedBg: c.primaryPressed, fg: c.primaryText, border: 'transparent' },
    secondary: { bg: c.surface, pressedBg: c.surfaceSunken, fg: c.text, border: c.borderStrong },
    soft: { bg: c.primarySoft, pressedBg: c.primarySoft, fg: c.primarySoftText, border: 'transparent' },
    danger: { bg: c.danger, pressedBg: c.danger, fg: '#FFFFFF', border: 'transparent' },
    success: { bg: c.success, pressedBg: c.success, fg: '#FFFFFF', border: 'transparent' },
    ghost: { bg: 'transparent', pressedBg: c.surfaceSunken, fg: c.primary, border: 'transparent' },
  };
  const palette = map[variant] || map.primary;
  return disabled ? { ...palette, bg: c.surfaceSunken, pressedBg: c.surfaceSunken, fg: c.textMuted, border: 'transparent' } : palette;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  haptic = true,
  style,
  ...rest
}) {
  const theme = useTheme();
  const s = SIZES[size] || SIZES.md;
  const palette = paletteFor(theme, variant, disabled || loading);

  const handlePress = useCallback(
    (event) => {
      if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPress?.(event);
    },
    [haptic, onPress],
  );

  const iconNode = icon ? <Ionicons name={icon} size={s.icon} color={palette.fg} /> : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: s.minHeight,
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          borderRadius: theme.radius.md,
          backgroundColor: pressed ? palette.pressedBg : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.border === 'transparent' ? 0 : 1,
          opacity: pressed ? 0.95 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      {...rest}
    >
      <View style={[styles.content, { gap: s.gap }]}>
        {loading ? (
          <ActivityIndicator size="small" color={palette.fg} />
        ) : (
          iconPosition === 'left' && iconNode
        )}
        {label ? (
          <Text variant={s.variant} color={palette.fg} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {!loading && iconPosition === 'right' ? iconNode : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});

export default Button;
