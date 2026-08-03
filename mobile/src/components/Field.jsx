import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme';
import { Text } from './Text';

/** Labelled text input with hint + error slots. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  required = false,
  multiline = false,
  icon,
  style,
  inputStyle,
  ...rest
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;

  return (
    <View style={[{ gap: theme.spacing.sm }, style]}>
      {label ? (
        <Text variant="smallStrong" tone="secondary">
          {label}
          {required ? <Text variant="smallStrong" tone="danger">{' *'}</Text> : null}
        </Text>
      ) : null}
      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: theme.colors.surface,
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.sm,
            alignItems: multiline ? 'flex-start' : 'center',
            paddingVertical: multiline ? theme.spacing.md : 0,
          },
        ]}
      >
        {icon ? (
          <Ionicons name={icon} size={18} color={focused ? theme.colors.primary : theme.colors.textMuted} style={multiline ? { marginTop: 2 } : null} />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          multiline={multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          maxFontSizeMultiplier={1.4}
          style={[
            theme.typography.body,
            styles.input,
            {
              color: theme.colors.text,
              minHeight: multiline ? 96 : 48,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            inputStyle,
          ]}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="small" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Horizontal single-choice control. Falls back to wrapping chips when there are
 * more options than fit a segmented row.
 */
export function ChoiceField({ label, value, options, onChange, hint, error, required = false, style }) {
  const theme = useTheme();
  return (
    <View style={[{ gap: theme.spacing.sm }, style]}>
      {label ? (
        <Text variant="smallStrong" tone="secondary">
          {label}
          {required ? <Text variant="smallStrong" tone="danger">{' *'}</Text> : null}
        </Text>
      ) : null}
      <View style={[styles.chips, { gap: theme.spacing.sm }]}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(selected && option.clearable !== false ? null : option.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: theme.spacing.lg,
                  backgroundColor: selected ? theme.colors.primary : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                },
              ]}
            >
              <Text variant="smallStrong" color={selected ? theme.colors.primaryText : theme.colors.textSecondary}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="small" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Checkbox row used for consent and declaration gates. */
export function CheckField({ label, description, value, onChange, error, style }) {
  const theme = useTheme();
  return (
    <View style={style}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
        onPress={() => onChange(!value)}
        style={({ pressed }) => [
          styles.check,
          {
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            borderRadius: theme.radius.md,
            borderColor: error ? theme.colors.danger : value ? theme.colors.primary : theme.colors.border,
            backgroundColor: pressed ? theme.colors.surfaceSunken : value ? theme.colors.primarySoft : theme.colors.surface,
          },
        ]}
      >
        <View
          style={[
            styles.checkBox,
            {
              borderRadius: theme.radius.sm - 2,
              borderColor: value ? theme.colors.primary : theme.colors.borderStrong,
              backgroundColor: value ? theme.colors.primary : 'transparent',
            },
          ]}
        >
          {value ? <Ionicons name="checkmark" size={15} color={theme.colors.primaryText} /> : null}
        </View>
        <View style={styles.checkBody}>
          <Text variant="smallStrong">{label}</Text>
          {description ? (
            <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
              {description}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {error ? (
        <Text variant="small" tone="danger" style={{ marginTop: theme.spacing.xs }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: { flexDirection: 'row' },
  input: { flex: 1, paddingVertical: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { paddingVertical: 9, borderWidth: 1 },
  check: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1 },
  checkBox: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkBody: { flex: 1 },
});
