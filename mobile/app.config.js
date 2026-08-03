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
 *   KHOZO_ENV=production KHOZO_API_URL=https://api.khozo.org npx expo prebuild -p android
 */

const ENV = process.env.KHOZO_ENV || 'pilot';
const IS_PRODUCTION = ENV === 'production';

// Play requires a new, higher versionCode for every upload. Bump VERSION_CODE
// (or set KHOZO_VERSION_CODE in CI) on each release; `version` is what users see.
const VERSION = '1.0.0';
const VERSION_CODE = Number(process.env.KHOZO_VERSION_CODE || 1);

const API_URL =
  process.env.KHOZO_API_URL || (IS_PRODUCTION ? 'https://api.khozo.org' : 'http://192.168.1.8:4000');

if (IS_PRODUCTION && !API_URL.startsWith('https://')) {
  throw new Error(`Production builds require an HTTPS API URL, got: ${API_URL}`);
}

export default {
  expo: {
    // The launcher label is always "Khozo" — pilot and production builds are
    // told apart by versionCode, not by a different name on the user's phone.
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
      ],
      // Declared so the merged manifest cannot inherit them from a dependency:
      // every permission has to be justified in the Play Console.
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
        'expo-build-properties',
        {
          android: {
            // Play rejects apps that send personal data over plaintext HTTP.
            usesCleartextTraffic: !IS_PRODUCTION,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
            // Shrink + strip for release; keeps the AAB well under Play limits.
            enableProguardInReleaseBuilds: IS_PRODUCTION,
            enableShrinkResourcesInReleaseBuilds: IS_PRODUCTION,
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
