import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { Banner, Button, Card, Screen, Text, TextField } from '../components';
import { ApiError } from '../services/api';
import { useAuth } from '../services/auth';
import { getApiBaseUrl } from '../services/config';
import { useTheme } from '../theme';

export default function SignInScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!email.trim() || !password) {
      setError('Enter your official email and password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigation.goBack();
    } catch (err) {
      setError(
        err instanceof ApiError && err.isNetworkError
          ? `${err.message}\n\nCurrent server: ${getApiBaseUrl()}`
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  }, [email, password, signIn, navigation]);

  return (
    <Screen edges={{ top: false, bottom: false }}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
          <Ionicons name="shield-half" size={28} color={theme.colors.primarySoftText} />
        </View>
        <Text variant="title" style={{ marginTop: theme.spacing.lg }}>
          Official sign in
        </Text>
        <Text variant="small" tone="muted" style={{ marginTop: 4, textAlign: 'center' }}>
          For police, SJPU, CWC, DCPU, RPF, CCI and partner accounts
        </Text>
      </View>

      <Card style={{ marginTop: theme.spacing.xl, gap: theme.spacing.lg }}>
        <TextField
          label="Official email"
          icon="mail-outline"
          placeholder="name@department.gov.in"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
        />
        <TextField
          label="Password"
          icon="lock-closed-outline"
          placeholder="Your password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: showPassword }}
          accessibilityLabel="Show password"
          onPress={() => setShowPassword((v) => !v)}
          style={[styles.toggle, { gap: theme.spacing.sm }]}
        >
          <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={16} color={theme.colors.textMuted} />
          <Text variant="small" tone="muted">
            {showPassword ? 'Hide password' : 'Show password'}
          </Text>
        </Pressable>

        {error ? <Banner tone="danger" title="Could not sign in" message={error} /> : null}

        <Button label="Sign in" icon="log-in-outline" loading={busy} onPress={submit} fullWidth />
      </Card>

      <Banner
        tone="info"
        icon="information-circle"
        title="No public sign-up here"
        message="Police and government accounts are provisioned by an administrator. Citizens do not need an account — sightings, bulletins and case tracking all work signed out."
        style={{ marginTop: theme.spacing.lg }}
      />

      <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.lg, textAlign: 'center' }}>
        Connecting to {getApiBaseUrl()}
      </Text>
      <Button
        label="Change server address"
        variant="ghost"
        size="sm"
        onPress={() => navigation.navigate('Settings')}
        style={{ alignSelf: 'center' }}
      />

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', paddingTop: 16 },
  badge: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
});
