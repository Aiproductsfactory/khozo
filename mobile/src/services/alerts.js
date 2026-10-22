import { Platform } from 'react-native';
import Constants from 'expo-constants';
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
 * Two ways an alert reaches the phone:
 *
 *   * *Local* notifications, raised by the app's own alert poll while it is
 *     open or in the background (useUnreadAlerts).
 *   * *Push*, sent by the server the moment a sighting is reported near this
 *     officer's station (shared/station-alerts.js). This reaches a phone whose
 *     app has been swept away too, but only in a build that has an Expo
 *     project id and the Firebase credential behind it (app.config.js).
 *
 * A sighting sent to the officer's station is the one alert that must wake
 * someone: it comes on its own channel, URGENT_CHANNEL_ID, with Khozo's alarm
 * sound at alarm volume, so it rings even when the phone is on silent. Every
 * other alert keeps the device's own tone.
 */

const CHANNEL_ID = 'khozo-sightings';
/** The server sends station alerts to this channel (URGENT_CHANNEL in shared/station-alerts.js). */
export const URGENT_CHANNEL_ID = 'khozo-urgent';
/** Bundled by the expo-notifications plugin (app.config.js); made by scripts/generate-alarm-sound.mjs. */
const URGENT_SOUND = 'khozo_alarm.wav';
/** Alert kinds the server also pushes; the poll leaves them to the push once push is set up. */
export const PUSHED_KINDS = new Set(['station_alert', 'station_alert_escalated']);

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
    // An Android channel's sound and importance are fixed when it is first
    // created, so this one has its own id rather than changing the old one.
    await Notifications.setNotificationChannelAsync(URGENT_CHANNEL_ID, {
      name: 'Sightings near your station',
      description: 'A sighting the police station must go to. Rings like an alarm, even on silent.',
      importance: Notifications.AndroidImportance.MAX,
      sound: URGENT_SOUND,
      // Alarm volume, not notification volume: a phone on silent still rings.
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
      vibrationPattern: [0, 800, 400, 800, 400, 800, 400, 800],
      // Rings through Do Not Disturb only once the officer has allowed it for
      // Khozo in the phone's settings; Android ignores it until then.
      bypassDnd: true,
      lightColor: '#DC2626',
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
export async function presentAlert({ title, body, scope, priority, kind }) {
  Haptics.notificationAsync(
    priority === 'high' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
  ).catch(() => {});

  const urgent = PUSHED_KINDS.has(kind);
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: urgent ? URGENT_SOUND : 'default',
      priority: urgent ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.HIGH,
      data: { scope },
    },
    // Fires at once. On Android it names the channel, which decides the sound:
    // without one the alert landed on a quiet fallback channel.
    trigger: Platform.OS === 'android' ? { channelId: urgent ? URGENT_CHANNEL_ID : CHANNEL_ID } : null,
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

/**
 * The Expo project id push tokens are issued for, from the build
 * (KHOZO_EAS_PROJECT_ID in app.config.js). Null in a build made without one.
 */
export function pushProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || null;
}

/**
 * This phone's push token, or why there is none:
 * `{ token }` or `{ token: null, reason }`, where reason is
 *
 *   * `no_project` — this build was made without an Expo project id, so the
 *     server cannot push to it; alerts arrive only while the app runs;
 *   * `denied` — the officer has not allowed notifications;
 *   * `unsupported` — not a real phone (the web build, a simulator);
 *   * `failed` — the push service did not answer.
 *
 * Never throws: a phone that cannot get push must still sign in.
 */
export async function getPushToken() {
  if (Platform.OS === 'web') return { token: null, reason: 'unsupported' };
  const projectId = pushProjectId();
  if (!projectId) return { token: null, reason: 'no_project' };
  // The channels exist before the permission prompt: Android 13 asks only once
  // a channel does.
  await configureAlerts().catch(() => {});
  const allowed = await ensureAlertPermission().catch(() => false);
  if (!allowed) return { token: null, reason: 'denied' };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data ? { token: data } : { token: null, reason: 'failed' };
  } catch (error) {
    return { token: null, reason: /simulator|emulator|physical device/i.test(error?.message || '') ? 'unsupported' : 'failed' };
  }
}

/** Whether the officer has allowed notifications: 'granted' | 'denied' | 'undetermined'. */
export async function alertPermissionState() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

/** A name for this phone in the officer's list of devices, e.g. "Redmi Note 12". */
export function deviceName() {
  return Constants.deviceName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
}
