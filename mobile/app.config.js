/**
 * Expo app config.
 *
 * Dynamic rather than a static app.json because release builds must differ from
 * pilot builds in ways Google Play cares about:
 *
 *   KHOZO_ENV=production  -> HTTPS only, no cleartext traffic (Play requirement)
 *   KHOZO_ENV=pilot       -> cleartext allowed, for a LAN/USB backend on a field network
 *
 * Build with:
 *   KHOZO_ENV=production KHOZO_API_URL=https://khozo.swastik-kumar.workers.dev npx expo prebuild -p android
 *
 * Add KHOZO_EAS_PROJECT_ID=<Expo project id> for push alerts to reach the
 * phone when the app is closed (station alerts, shared/station-alerts.js).
 */

const ENV = process.env.KHOZO_ENV || 'production';
const IS_PRODUCTION = ENV === 'production';

const VERSION = '1.0.0';
const VERSION_CODE = Number(process.env.KHOZO_VERSION_CODE || 1);

const API_URL =
  process.env.KHOZO_API_URL || 'https://khozo.swastik-kumar.workers.dev';

// The Expo project push tokens are issued for. Without it the server cannot
// push to the app, and alerts reach a phone only while the app is running.
// Push to Android also needs the project's Firebase credential uploaded to
// Expo (`eas credentials`); nothing secret is built into the app.
const EAS_PROJECT_ID = process.env.KHOZO_EAS_PROJECT_ID || null;

if (IS_PRODUCTION && !API_URL.startsWith('https://')) {
  throw new Error(`Production builds require an HTTPS API URL, got: ${API_URL}`);
}

export default {
  expo: {
    name: 'Khozo',
    slug: 'khozo-mobile',
    version: VERSION,
    orientation: 'portrait',
    scheme: 'khozo',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    assetBundlePatterns: ['**/*'],

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'org.khozo.field',
      buildNumber: String(VERSION_CODE),
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },

    android: {
      package: 'org.khozo.field',
      versionCode: VERSION_CODE,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#312E81',
      },
      permissions: [
        'android.permission.CAMERA',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        // Android 13+ will not show a sighting alert without this.
        'android.permission.POST_NOTIFICATIONS',
      ],
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
      ],
    },

    web: { favicon: './assets/favicon.png' },

    plugins: [
      'expo-status-bar',
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
          backgroundColor: '#312E81',
          dark: { backgroundColor: '#0B1020' },
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission:
            'Khozo uses the camera so you can attach a photo to a child sighting report. Photos are reviewed only by authorised child-protection officers.',
          recordAudioAndroid: false,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Khozo uses your location to tag where a child was seen, so the nearest police / CWC team can respond.',
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'Khozo needs access to your photos so you can attach an existing picture to a sighting report.',
        },
      ],
      [
        // Most alerts use the device's own notification tone, so they respect
        // the officer's volume and sound like every other alert they act on.
        // A sighting sent to the officer's station is the exception: it must
        // wake a sleeping in-charge, so it rings with Khozo's alarm on its own
        // channel at alarm volume (src/services/alerts.js). That is the one
        // sound shipped; scripts/generate-alarm-sound.mjs makes it.
        'expo-notifications',
        {
          color: '#4338CA',
          sounds: ['./assets/sounds/khozo_alarm.wav'],
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: !IS_PRODUCTION,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
            enableProguardInReleaseBuilds: false,
            enableShrinkResourcesInReleaseBuilds: false,
          },
        },
      ],
    ],

    extra: {
      khozoApiUrl: API_URL,
      khozoEnv: ENV,
      ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    },
  },
};
