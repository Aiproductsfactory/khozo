import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { createNavigationContainerRef, DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '../components';
import { useAuth } from '../services/auth';
import { useOutbox } from '../services/outbox';
import { useUnreadAlerts } from '../hooks/useUnreadAlerts';
import { onAlertOpened } from '../services/alerts';
import { useTheme } from '../theme';

import HomeScreen from '../screens/HomeScreen';
import ReportSightingScreen from '../screens/ReportSightingScreen';
import SightingSubmittedScreen from '../screens/SightingSubmittedScreen';
import BulletinsScreen from '../screens/BulletinsScreen';
import BulletinDetailScreen from '../screens/BulletinDetailScreen';
import TrackScreen from '../screens/TrackScreen';
import AccountScreen from '../screens/AccountScreen';
import SignInScreen from '../screens/SignInScreen';
import SettingsScreen from '../screens/SettingsScreen';
import OutboxScreen from '../screens/OutboxScreen';
import ReviewQueueScreen from '../screens/ReviewQueueScreen';
import AlertsScreen from '../screens/AlertsScreen';
import ReviewDetailScreen from '../screens/ReviewDetailScreen';
import CasesScreen from '../screens/CasesScreen';
import CaseDetailScreen from '../screens/CaseDetailScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

export const navigationRef = createNavigationContainerRef();

/** Small count bubble on the Report tab showing unsent sightings. */
function TabBadge({ count }) {
  const theme = useTheme();
  if (!count) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: -4,
        right: -10,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        borderRadius: 8,
        backgroundColor: theme.colors.danger,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="caption" color="#FFFFFF" style={{ fontSize: 9, letterSpacing: 0 }}>
        {count > 9 ? '9+' : count}
      </Text>
    </View>
  );
}

function tabIcon(name, badgeCount) {
  return function TabIcon({ color, size, focused }) {
    return (
      <View>
        <Ionicons name={focused ? name : `${name}-outline`} size={size} color={color} />
        <TabBadge count={badgeCount} />
      </View>
    );
  };
}

function Tabs() {
  const theme = useTheme();
  const { canReviewSightings } = useAuth();
  const { pendingCount } = useOutbox();
  const unreadAlerts = useUnreadAlerts();

  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: theme.colors.primary,
      tabBarInactiveTintColor: theme.colors.textMuted,
      tabBarStyle: {
        backgroundColor: theme.colors.surface,
        borderTopColor: theme.colors.border,
        height: 62,
        paddingTop: 6,
        paddingBottom: 8,
      },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }),
    [theme],
  );

  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: tabIcon('home') }} />
      {canReviewSightings ? (
        <Tab.Screen
          name="Alerts"
          component={AlertsScreen}
          options={{ title: 'Alerts', tabBarIcon: tabIcon('notifications', unreadAlerts) }}
        />
      ) : null}
      {canReviewSightings ? (
        <Tab.Screen
          name="Review"
          component={ReviewQueueScreen}
          options={{ title: 'Review', tabBarIcon: tabIcon('shield-checkmark') }}
        />
      ) : null}
      <Tab.Screen
        name="Report"
        component={ReportSightingScreen}
        options={{ title: 'Report', tabBarIcon: tabIcon('camera', pendingCount) }}
      />
      {canReviewSightings ? (
        <Tab.Screen name="Cases" component={CasesScreen} options={{ tabBarIcon: tabIcon('folder-open') }} />
      ) : (
        <Tab.Screen name="Bulletins" component={BulletinsScreen} options={{ tabBarIcon: tabIcon('megaphone') }} />
      )}
      {canReviewSightings ? null : (
        <Tab.Screen name="Track" component={TrackScreen} options={{ tabBarIcon: tabIcon('search') }} />
      )}
      <Tab.Screen name="Account" component={AccountScreen} options={{ tabBarIcon: tabIcon('person-circle') }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const theme = useTheme();

  // A notification tap arrives from outside React, including on a cold start,
  // so opening the sighting it points at needs a handle on the navigator rather
  // than a hook inside a screen.
  useEffect(
    () =>
      onAlertOpened((scope) => {
        if (!navigationRef.isReady()) return;
        if (scope?.foundReportId) navigationRef.navigate('ReviewDetail', { id: scope.foundReportId });
        else if (scope?.reportId) navigationRef.navigate('CaseDetail', { id: scope.reportId });
      }),
    [],
  );

  const navTheme = useMemo(() => {
    const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
      },
    };
  }, [theme]);

  const stackOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: theme.colors.surface },
      headerTintColor: theme.colors.text,
      headerTitleStyle: { fontSize: 17, fontWeight: '700' },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: theme.colors.background },
    }),
    [theme],
  );

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <Stack.Navigator screenOptions={stackOptions}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Bulletins" component={BulletinsScreen} options={{ title: 'Public bulletins' }} />
        <Stack.Screen name="Track" component={TrackScreen} options={{ title: 'Track a case' }} />
        <Stack.Screen name="BulletinDetail" component={BulletinDetailScreen} options={{ title: 'Bulletin' }} />
        <Stack.Screen
          name="SightingSubmitted"
          component={SightingSubmittedScreen}
          options={{ title: 'Report submitted', headerBackVisible: false, gestureEnabled: false }}
        />
        <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Official sign in' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Outbox" component={OutboxScreen} options={{ title: 'Unsent reports' }} />
        <Stack.Screen name="ReviewDetail" component={ReviewDetailScreen} options={{ title: 'Sighting review' }} />
        <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: 'Case' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default RootNavigator;
