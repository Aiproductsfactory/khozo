import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { RootNavigator } from './navigation';
import { AuthProvider } from './services/auth';
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
  // Nothing has to be fetched before the first screen can render, so the splash
  // comes down as soon as the tree mounts.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

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
