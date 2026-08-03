import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { RootNavigator } from './navigation';
import { AuthProvider } from './services/auth';
import { loadApiBaseUrl } from './services/config';
import { OutboxProvider } from './services/outbox';
import { ThemeProvider, useTheme } from './theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Root() {
  const theme = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <AuthProvider>
        <OutboxProvider>
          <RootNavigator />
        </OutboxProvider>
      </AuthProvider>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The stored server address must be in place before any screen mounts,
    // otherwise the first requests would go to the build-time default.
    loadApiBaseUrl()
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Root />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
