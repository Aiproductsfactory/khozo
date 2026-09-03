import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { INDIAN_STATES } from '../../../shared/india';
import { useTheme } from '../theme';
import { Text } from './Text';
import { TextField } from './Field';

/**
 * State entry for a sighting, with suggestions.
 *
 * The state is what routes a report to the officers who can act on it, so a
 * misspelling costs more than a moment's typing: a sighting that matches no
 * jurisdiction used to reach nobody's queue. Free text with the recognised
 * names one tap away gets the value right without making a citizen scroll
 * thirty-six options on a phone.
 */
export function StateField({ value, onChange, style }) {
  const theme = useTheme();
  const [touched, setTouched] = useState(false);

  const query = String(value || '').trim().toLowerCase();
  const exact = useMemo(
    () => INDIAN_STATES.some((state) => state.toLowerCase() === query),
    [query],
  );
  const suggestions = useMemo(() => {
    if (!query || exact) return [];
    return INDIAN_STATES.filter((state) => state.toLowerCase().includes(query)).slice(0, 6);
  }, [query, exact]);

  return (
    <View style={style}>
      <TextField
        label="State"
        placeholder="e.g. Assam"
        value={value}
        onChangeText={(next) => {
          setTouched(true);
          onChange(next);
        }}
        autoCapitalize="words"
        autoCorrect={false}
        hint={
          exact
            ? 'Recognised — this report will reach that state’s officers'
            : 'Optional. Without it the report goes to every review desk.'
        }
      />

      {touched && suggestions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.row, { gap: theme.spacing.sm, paddingTop: theme.spacing.sm }]}
        >
          {suggestions.map((state) => (
            <Pressable
              key={state}
              onPress={() => onChange(state)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: theme.spacing.lg,
                  backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text variant="smallStrong" color={theme.colors.textSecondary}>
                {state}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
});
