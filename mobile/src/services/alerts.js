import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

/**
 * Device alerts for officers.
 *
 * A sighting is only useful if someone reads it, and an officer is not sitting
 * on the Alerts tab. So a new sighting raises a real system notification —
 * sound, banner, and a tap that opens the report — rather than a number that
 * changes quietly inside a screen nobody is looking at.
 *
 * The sound is the device's default notification tone rather than a bundled
 * file: it is the sound the officer already recognises, it respects their
 * volume, Do Not Disturb and accessibility settings, and it cannot be louder
 * than they have allowed.
 *
 * Scope, stated plainly: these are *local* notifications, raised by the app
 * while it is running. Reaching a phone whose app has been swept away needs a
 * push credential (FCM) and a server that sends to it — the pieces are in place
 * for that (per-officer notification rows already exist server-side), but the
 * credential is not, so this delivers to an app that is open or backgrounded,
 * not to a cold-started one.
 */

const CHANNEL_ID = 'khozo-sightings';

// A sighting is time-critical, so it shows and sounds even while the officer is
// using something else.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Creates the Android channel. Safe to call repeatedly. */
export async function configureAlerts() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Child sighting alerts',
      description: 'Raised when a member of the public reports spotting a child.',
      // HIGH is what makes Android play the sound and show a heads-up banner.
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4338CA',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

/**
 * Asks for permission to post notifications.
 *
 * Android 13+ requires it explicitly. Returns whether alerts can be shown, so
 * the caller can tell an officer their alerts are muted rather than leaving
 * them believing they are covered.
 */
export async function ensureAlertPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return Boolean(asked.granted);
}

/**
 * Raises one alert on the device.
 *
 * `scope` travels with it so a tap can open the exact sighting rather than a
 * list the officer then has to search.
 */
export async function presentAlert({ title, body, scope, priority }) {
  Haptics.notificationAsync(
    priority === 'high' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
  ).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: { scope },
    },
    // null fires immediately.
    trigger: null,
  }).catch(() => {
    // A device that refuses to show the notification must not take the polling
    // loop down with it; the in-app badge still updates.
  });
}

/**
 * Calls `onOpen` with the alert's scope when the officer taps a notification,
 * including the tap that cold-started the app.
 */
export function onAlertOpened(onOpen) {
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const scope = response?.notification?.request?.content?.data?.scope;
      if (scope) onOpen(scope);
    })
    .catch(() => {});

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const scope = response?.notification?.request?.content?.data?.scope;
    if (scope) onOpen(scope);
  });

  return () => subscription.remove();
}
