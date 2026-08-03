import React from 'react';
import { Text as RNText } from 'react-native';

import { useTheme } from '../theme';

/**
 * Typography primitive. Every string in the app goes through this so the
 * type scale and colour roles stay consistent.
 *
 * `variant` picks the size/weight, `tone` picks the colour role.
 */
export function Text({ variant = 'body', tone = 'default', color, style, children, ...rest }) {
  const theme = useTheme();
  const toneColor =
    color ||
    {
      default: theme.colors.text,
      secondary: theme.colors.textSecondary,
      muted: theme.colors.textMuted,
      inverse: theme.colors.textInverse,
      primary: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      danger: theme.colors.danger,
      info: theme.colors.info,
    }[tone] ||
    theme.colors.text;

  return (
    <RNText
      // Cap system font scaling so field officers with large-text settings
      // still get a usable layout instead of an unreadable one.
      maxFontSizeMultiplier={1.5}
      style={[theme.typography[variant] || theme.typography.body, { color: toneColor }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

export default Text;
