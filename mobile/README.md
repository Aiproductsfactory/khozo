# Khozo Field (mobile)

React Native / Expo app for the Khozo child-reunification platform. It talks to the
same API as the web dashboard (`server/`) — there is no separate mobile datastore.

Two audiences share one build:

| Audience | Signed in? | Tabs |
| --- | --- | --- |
| Public / citizen | No | Home · Report · Bulletins · Track · Account |
| Officer (police, SJPU, CWC, DCPU, RPF, CCI, …) | Yes | Home · Review · Report · Cases · Account |

The tab set switches on the signed-in user's role, using the same role lists the
server enforces (`REVIEW_ROLES`, `FORMAL_CASE_ROLES`). The client only decides what
to *show*; every action is authorised server-side.

## What it does

**Anyone, without an account**

- **Report a sighting** — a three-step flow (photo → details → confirm) with camera
  capture, gallery import, GPS + reverse geocoding, an explicit consent gate, and a
  "keep my identity confidential" option. Photos are downscaled to 1280 px before
  upload so they go through on a weak connection.
- **Public bulletins** — only cases an agency has actively published.
- **Track** — look up a sighting receipt or a case / FIR / external ID. Receipts for
  reports made from this phone are listed locally for one-tap lookup.

**Officers**

- **Review queue** — jurisdiction-scoped sightings, sorted strong-candidate-first,
  with confirm / refer-to-CWC / not-a-match decisions. Confirming a reunification is
  restricted to police and command roles, matching the server.
- **Cases** — scoped case list and detail, including the guardian contact and recent
  workflow events.

## Offline behaviour

Sightings are written to a durable outbox **before** upload:

- the payload goes to `AsyncStorage`, the photo is copied out of the cache directory
  into app documents so Android cannot purge it;
- the queue drains on app start, on regaining connectivity, and on foreground;
- a 4xx response parks the item with a permanent error for the user to review rather
  than retrying forever; anything else (offline, timeout, 5xx) stays queued.

This matters because field reporting happens exactly where signal is worst — railway
platforms, bus stands, rural roads.

## Privacy posture

The app deliberately never shows a reporter the identity of a child their sighting
matched — that is the server's design and the UI states it explicitly. Only the
sign-in token, unsent reports and their photos are stored on the device; case records
and child identities are never cached.

Match scores are shown to officers as **bands** ("Strong candidate", "Possible
candidate") alongside the number, with a standing note that scores are an aid and not
evidence. A bare "98.2% match" implies a precision the pipeline does not have.

## Running it

```bash
cd mobile
npm install
npm run android          # build + install a debug build on a connected device
```

Assets (icon, splash, notification icon) are generated, not committed as opaque
binaries — regenerate with:

```bash
node scripts/generate-assets.mjs
```

### Building an installable APK

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease      # gradlew.bat on Windows
adb install -r app/build/outputs/apk/release/app-release.apk
```

`release` is signed with the debug keystore by the Expo template, so the APK installs
without any signing setup. Generate a real upload key before distributing it.

#### Build environment notes

These were all hit while producing the first working APK on Windows:

- **Use JDK 21, not 17.** Under JDK 17 the `JdkImageTransform` step fails
  (`jlink` errors out on `core-for-system-modules.jar` for android-36). Set
  `JAVA_HOME` to a 21 JDK for the Gradle invocation.
- **`android/gradle.properties` builds `arm64-v8a` only.** Compiling all four ABIs
  needs roughly 4x the native build work and exhausted the Windows page file on a
  24 GB machine. Add ABIs back when you need an emulator (`x86_64`) or older devices
  (`armeabi-v7a`); `-PreactNativeArchitectures=…` overrides it per build.
- `org.gradle.parallel=false` and `workers.max=2` are set for the same reason — each
  parallel `clang++` reserves a large chunk of commit charge.
- The NDK is ~5 GB. If your system drive is short on space, point the SDK's `ndk` and
  `.temp` directories elsewhere (on Windows, a directory junction works and is
  transparent to Gradle) and set `GRADLE_USER_HOME` off the system drive too.
- `expo prebuild` regenerates `android/`, which **discards these gradle.properties
  edits**. Re-apply them, or drive prebuild from a config plugin, after a `--clean`.

### Server address

The app needs to reach the Khozo API. A phone cannot resolve your computer's
`localhost`, so on first launch it probes, in order:

1. `expo.extra.khozoApiUrl` from `app.json` (a LAN address — set this for a pilot),
2. `http://localhost:4000` (works when tethered over USB with `adb reverse tcp:4000 tcp:4000`),
3. `http://10.0.2.2:4000` (Android emulator).

The first one that answers `/api/health` is remembered. **Account → Server** lets you
override it and test the connection, which is what you want when moving between
networks. Cleartext HTTP is enabled for these pilot/LAN deployments via
`expo-build-properties`; use HTTPS for anything public.

Prefer the LAN address over `adb reverse` when testing on a physical device. The USB
tunnel is torn down whenever the cable re-enumerates or the phone drops to
"charging only", and because it fails silently, uploads look like app bugs. Put the
phone on the same Wi-Fi as the API instead — the server listens on all interfaces, so
only the host firewall needs to allow inbound TCP 4000.

## Layout

```
src/
  App.jsx              providers + splash gating
  navigation/          role-aware tabs and root stack
  theme/               design tokens, light + dark
  components/          Text, Button, Screen, Card/Badge/Banner, fields, skeletons
  services/
    config.js          server address: probing, validation, persistence
    api.js             single fetch entry point (timeouts, auth, ApiError)
    auth.jsx           session restore, sign in/out, role capability flags
    queue.js           durable sighting outbox
    outbox.jsx         decides when to drain the queue
  screens/             one file per screen
  hooks/useAsync.js    load / error / refresh with stale-response guarding
  utils/format.js      dates, status labels, match bands
```
