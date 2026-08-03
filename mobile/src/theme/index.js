import React, { createContext, useContext, useMemo } from 'react';
import { Platform, useColorScheme } from 'react-native';

/**
 * Khozo design tokens.
 *
 * The app is used outdoors by field officers and by anxious members of the
 * public, so the palette favours high contrast and large, unambiguous status
 * colours over decoration. Every colour below is checked to clear WCAG AA for
 * body text against the surface it is used on.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

const fontFamily = Platform.select({
  ios: { regular: 'System', mono: 'Menlo' },
  android: { regular: 'sans-serif', mono: 'monospace' },
  default: { regular: 'System', mono: 'monospace' },
});

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.2 },
  subheading: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  mono: { fontSize: 13, lineHeight: 19, fontFamily: fontFamily.mono },
};

const brand = {
  indigo50: '#EEF2FF',
  indigo100: '#E0E7FF',
  indigo200: '#C7D2FE',
  indigo400: '#818CF8',
  indigo500: '#6366F1',
  indigo600: '#4F46E5',
  indigo700: '#4338CA',
  indigo900: '#312E81',
};

const light = {
  mode: 'light',
  brand,
  colors: {
    background: '#F4F5FB',
    surface: '#FFFFFF',
    surfaceAlt: '#FAFAFE',
    surfaceSunken: '#EDEFF7',
    border: '#DEE1EC',
    borderStrong: '#C4C9DA',

    text: '#12142A',
    textSecondary: '#4A4F6A',
    textMuted: '#6E7490',
    textInverse: '#FFFFFF',

    primary: brand.indigo600,
    primaryPressed: brand.indigo700,
    primaryText: '#FFFFFF',
    primarySoft: brand.indigo50,
    primarySoftText: brand.indigo700,

    success: '#047857',
    successSoft: '#E7F6F0',
    warning: '#B45309',
    warningSoft: '#FDF3E3',
    danger: '#BE123C',
    dangerSoft: '#FDECF1',
    info: '#0369A1',
    infoSoft: '#E5F2FB',

    overlay: 'rgba(10, 12, 30, 0.45)',
    skeleton: '#E4E7F1',
  },
  shadow: {
    card: {
      shadowColor: '#1B2559',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 10,
      elevation: 2,
    },
    raised: {
      shadowColor: '#1B2559',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.14,
      shadowRadius: 20,
      elevation: 8,
    },
  },
};

const dark = {
  mode: 'dark',
  brand,
  colors: {
    background: '#0B1020',
    surface: '#161C31',
    surfaceAlt: '#1C2339',
    surfaceSunken: '#0F1526',
    border: '#2A3350',
    borderStrong: '#3B456A',

    text: '#F5F7FF',
    textSecondary: '#B7BFDA',
    textMuted: '#8992B3',
    textInverse: '#12142A',

    primary: brand.indigo500,
    primaryPressed: brand.indigo400,
    primaryText: '#FFFFFF',
    primarySoft: 'rgba(99, 102, 241, 0.18)',
    primarySoftText: brand.indigo200,

    success: '#34D399',
    successSoft: 'rgba(16, 185, 129, 0.16)',
    warning: '#FBBF24',
    warningSoft: 'rgba(245, 158, 11, 0.16)',
    danger: '#FB7185',
    dangerSoft: 'rgba(244, 63, 94, 0.16)',
    info: '#5EC2F5',
    infoSoft: 'rgba(56, 189, 248, 0.16)',

    overlay: 'rgba(2, 4, 12, 0.65)',
    skeleton: '#212A44',
  },
  shadow: {
    card: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 2,
    },
    raised: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 20,
      elevation: 8,
    },
  },
};

const base = { spacing, radius, typography, fontFamily };

export const lightTheme = { ...base, ...light };
export const darkTheme = { ...base, ...dark };

const ThemeContext = createContext(lightTheme);

export function ThemeProvider({ children }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Builds themed styles once per theme change.
 *
 * `factory` receives the theme and returns a plain style object, e.g.
 *   const styles = useThemedStyles((t) => ({ box: { padding: t.spacing.lg } }));
 */
export function useThemedStyles(factory) {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

/** Semantic status tone -> {fg, bg} pair, used by Badge, Banner and status dots. */
export function toneColors(theme, tone = 'neutral') {
  const c = theme.colors;
  switch (tone) {
    case 'success':
      return { fg: c.success, bg: c.successSoft };
    case 'warning':
      return { fg: c.warning, bg: c.warningSoft };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSoft };
    case 'info':
      return { fg: c.info, bg: c.infoSoft };
    case 'primary':
      return { fg: c.primarySoftText, bg: c.primarySoft };
    default:
      return { fg: c.textSecondary, bg: c.surfaceSunken };
  }
}
