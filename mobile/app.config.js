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
 */

const ENV = process.env.KHOZO_ENV || 'production';
const IS_PRODUCTION = ENV === 'production';

const VERSION = '1.0.0';
const VERSION_CODE = Number(process.env.KHOZO_VERSION_CODE || 1);

const API_URL =
  process.env.KHOZO_API_URL || 'https://khozo.swastik-kumar.workers.dev';

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
        // Sighting alerts use the device's own notification tone rather than a
        // bundled sound, so they respect the officer's volume, Do Not Disturb
        // and accessibility settings and sound like every other alert they act
        // on. `sounds: []` is deliberate: no custom audio is shipped.
        'expo-notifications',
        {
          color: '#4338CA',
          sounds: [],
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
    },
  },
};
