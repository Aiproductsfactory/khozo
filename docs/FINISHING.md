# Finishing the current change

Everything in this file is a command to run and what it should print. It exists
because the last stretch of work was written without being able to execute
anything, so it has not been built, tested or deployed. Run these in order.

---

## 1. Install the one new dependency

Sighting alerts now raise a real device notification — sound, banner, and a tap
that opens the report. That needs `expo-notifications`, which is a native
module, so it needs installing and a rebuild.

```bash
cd mobile
npx expo install expo-notifications
cd ..
```

Use `npx expo install`, not `npm install`: it picks the version that matches
this Expo SDK. The version is deliberately not pinned in `package.json` for
that reason.

**Until this runs, the mobile app will not bundle** — `src/services/alerts.js`
imports the module.

---

## 2. Run the test suite

```bash
npm run test:all
```

Expected, all offline — no server, database or network:

```
API coverage checks passed
API smoke checks passed (express runtime)
API smoke checks passed (worker runtime)
Sighting alert checks passed              (29 checks)
Intake screening checks passed            (25 checks)
Worker store replica checks passed        (24 checks)
Web route guard checks passed
PWA/offline queue checks passed
```

`smoke:api` now makes a face-detection call per photo upload, so it is slower
than it was. If it fails, the likely causes in order:

1. `detectPerson` not wired into a runtime's dependency list — check
   `server/src/routes/reports.js`, `worker/index.js` and
   `scripts/worker-shim-server.mjs` all pass it.
2. The provider timing out; the screen falls back to `unverified`, which routes
   to the super admin. That is the designed behaviour, not a failure.

---

## 3. Build the web app

```bash
npm run build
```

This is the first build since the Sightings &amp; matches page, the Overview
work panel and the notification deep-links were written. If it fails it will be
a JSX or import error in one of:

- `web/src/dashboard/FoundReports.jsx`
- `web/src/dashboard/Overview.jsx`
- `web/src/dashboard/NotificationBell.jsx`

---

## 4. Deploy

```bash
node scripts/migrate.mjs     # idempotent; no new tables in this change
npx wrangler deploy
```

Then check the flow end to end: submit a sighting from the live site with a
photo of a person, and confirm every authority account is alerted and the
sighting appears in the review queues.

---

## 5. Rebuild and publish the Android app

```bash
cd mobile
KHOZO_ENV=production npx expo prebuild --platform android --clean
cd android
./gradlew.bat assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

If Gradle fails on `expo-log-box:verifyReleaseResources` with an AAPT2 daemon
error, re-run it — that crash is transient and the second run succeeds.

Publish it under the name the website links to:

```bash
gh release upload v1.0.0 android/app/build/outputs/apk/release/app-release.apk --clobber
```

The landing page links to
`releases/latest/download/app-release.apk`, so the asset name has to stay
`app-release.apk`.

---

## 6. Clear the seeded and test records

Every record currently in the database is seeded or test data. The three cases
are the face-match pipeline's fixtures — the photographs behind them are stock
pictures of adults, sitting in a missing-children register.

```bash
node scripts/purge-demo-data.mjs --all      # inventory, including what is kept
node scripts/purge-demo-data.mjs            # what would go, and why
node scripts/purge-demo-data.mjs --apply    # remove it
```

Add `--reset` to clear everything rather than only what matches a rule. Demo
accounts are never touched, and the audit log is append-only in the database, so
history is not tidied away with the records.

---

## Still outstanding

**Push notifications to a closed app.** What ships now is *local* notifications:
the app raises them while it is running or backgrounded. Reaching a phone whose
app has been swept away needs a Firebase Cloud Messaging credential and a server
that sends to it. The server side is already shaped for it — there is a
notification row per officer, with read state — so the remaining work is the FCM
credential, storing each device's push token, and sending from the Worker.

**The exposed database password.** `scripts/test-supabase-basic-auth.mjs` had it
in plaintext, committed in `baae704` on a public repository. The file is gone;
the history is not. Rotate it.
