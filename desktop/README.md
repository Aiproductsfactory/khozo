# Khozo Desktop: long CCTV footage, checked on the laptop

The police check CCTV footage of 30 minutes to 10 hours, from one camera or many. The browser's **Check CCTV video** button handles short clips. This folder is the start of the desktop version of Khozo for long footage.

The video stays on the officer's computer. Only small face pictures, their moments, the camera's place and the file's fingerprint (SHA-256) are sent to Khozo. Every result is a lead for an officer to check, never an identification.

There are two ways to use it:

| | What it is | For |
| --- | --- | --- |
| **The app** (`app/`) | A Windows program: sign in with the Khozo account, choose the case, add the videos, start, and look at the faces it finds | Police officers |
| **Two command-line tools** (`bin/`) | `scan.mjs` finds everyone in footage; `compare.mjs` compares them with a case and writes a review sheet | Measuring and checking on real footage |

Both reuse the browser's own code: `web/src/video/faces.js` (face boxes, tracking, picture quality) and the YuNet model file `web/src/video/yunet-2026may.onnx`.

## Install for development

```sh
cd desktop
npm install        # once, with internet: Electron, FFmpeg, the ONNX runtime and sharp
npm test           # 74 checks, no real case or face needed
npm start          # builds and opens the app
```

The desktop is a separate package so that the Worker build never downloads Electron or FFmpeg. In a terminal inside VS Code, `ELECTRON_RUN_AS_NODE` is set; unset it before `npm start` or Electron starts as plain Node.

## The app

**For the officer:**

1. Sign in with their Khozo account. Only police roles can check CCTV, as on khozo.org.
2. Choose the case, which must be open. A found child's case can be chosen too: the footage then shows where the child came from, and with whom.
3. Add the videos (files or a folder). For each, say where the camera is and, if known, when its recording starts. "Use this place for all videos" fills the rest from the first, for a batch of clips from one place.
4. Optionally choose the part of the day, for example 10:00 to 12:00 on the camera clock.
5. Start.

**Footage against open cases** (only when Khozo has `KHOZO_DESKTOP_OPEN_CASES` on; see `shared/open-case-checks.js`): for footage from a busy place with no one case. The officer narrows the open cases (sex, age today, district, when missing) and the screen says how many will be searched. Each person's clearest face is searched on Khozo, one at a time: the index's closest cases among those chosen, then both face engines; a face is shown only when the case is among the five closest, Aarakshak scores it at least 0.45 and AWS at least 0.90. Results are grouped by case. A case the officer can open comes with its photo; a case outside their area is not named, and "Send to that case's officers" passes the face to the officers who can look at it. No case photo or face template is on the laptop for this.

**While a check runs:**

- It reads the videos one by one, runs the first pass with Aarakshak's model if it is installed, and sends the closest faces to Khozo.
- It saves its progress every 30 seconds. A check stopped by a pause, a crash or a power cut carries on from there.
- The laptop stays awake.

**The results:**

- **Look at these first:** the faces Khozo marks likely, possibly, or where the two checks disagree.
- **Everyone seen:** every person in 15-minute slices.
- For each face the officer can **play from here** (a 20-second clip made on the spot from their own file), **see the full picture**, mark **Same person** (a sighting of the case on Khozo, with the face and the whole frame, waiting for the case officer's review; a note on a Khozo not yet updated) or **Not this person** (counted on Khozo, with no picture).
- **Seen within 10 seconds:** under a face marked as the person, the other people on that camera within ten seconds of the moment. Shown only; nobody is searched for.
- An **old case photo** (a case missing two years or more) is said on the check's page: matches will be weak, so look through "Everyone seen" too.
- **Answers with no internet** (only when Khozo has `KHOZO_DESKTOP_LAPTOP_ANSWERS` on): the laptop keeps the case's face signatures, encrypted, for the check's life, and a face it finds close shows as "On this laptop" until Khozo answers. The laptop signs the very 240 px copy Khozo is sent (`scanner/compare-copy.js`): on 80 faces the laptop and Aarakshak's own code agree within 0.014.
- **Watching a live camera** (only when Khozo has `KHOZO_DESKTOP_LIVE_WATCH` on): one case, one camera's stream address (RTSP, HTTP, UDP), until a set time. Each face is compared on the laptop as it is seen; only faces close to the case are kept, encrypted, with their whole frame, and sent to Khozo; the officer at the desk gets a Windows notice and a banner. Nothing of the stream is recorded. In tests a planted person reached the desk about two seconds after appearing on camera (`scanner/live.js`).
- On khozo.org, the case page shows the **route**: every moment sent to the case from any laptop, in time order, the cameras drawn from their map points, and each check's decisions with who made them and on which laptop.

**What stays on the laptop, and how:**

- Face pictures and job records are encrypted (AES-256-GCM). The key is kept by Windows for that user account.
- Each officer has their own folder.
- Clips and full frames are made when asked for and kept in memory only.
- Jobs are deleted when the officer deletes them, signs out, or leaves them untouched for 30 days.
- The sign-in token is encrypted by Windows and never reaches the screens.

**How it is built:**

- **Main process** (`app/main.js`): the window, sign-in, and a narrow bridge (`app/preload.cjs`). The screens (`app/renderer/`) have no Node.js and see pictures only through `khozo://`.
- **Scan worker** (`app/scan-worker.js`): the heavy work, in its own process.
- **Jobs** (`app/jobs.js`): the queue, saving and resuming, the first pass and sending.
- **Screen words:** English, Hindi and Gujarati (`app/renderer/i18n.js`). The Hindi and Gujarati need a native speaker's check.

### Building the installer

```sh
KHOZO_FACE_MODEL=<path to the private card> npm run dist
```

This writes `release/Khozo-Desktop-Setup-<version>.exe`, a per-user install that needs no administrator rights. With `KHOZO_FACE_MODEL` set, Aarakshak's model is inside the installer, so **give the installer out privately (pen drive, private link), never publicly**. Without it, the app sends every face to Khozo, the clearest 600 per video.

Unsigned, Windows SmartScreen warns on first run ("More info", then "Run anyway"). To sign it:

```sh
KHOZO_FACE_MODEL=<card> KHOZO_SIGN_PFX=<certificate.pfx> KHOZO_SIGN_PASSWORD=<its password> npm run dist:signed
KHOZO_FACE_MODEL=<card> KHOZO_SIGN_THUMBPRINT=<certificate thumbprint> npm run dist:signed   # a certificate on a USB token
```

`build/sign.mjs` signs the program, makes the installer from the signed program, signs the installer, and checks both, with Windows' own `Set-AuthenticodeSignature`. SmartScreen stops warning only with a code-signing certificate from a public certificate authority, issued to the organisation that gives the app out; a self-made certificate signs, but Windows does not trust it. `KHOZO_SIGN_TIMESTAMP` sets the time-stamping server (DigiCert's by default; `none` to sign without one).

### Giving out a new version

The app asks Khozo for the newest version at sign-in and twice a day (`GET /api/dashboard/desktop-version`), and shows it on its home screen. Set these on the Worker (`npx wrangler secret put <NAME>`):

- `KHOZO_DESKTOP_LATEST_VERSION`: the new version, for example `0.2.3`.
- `KHOZO_DESKTOP_LATEST_SHA256`: the installer's SHA-256 (the `.sha256.txt` written beside it). The app installs nothing that does not match it.
- `KHOZO_DESKTOP_DOWNLOAD_URL` (optional): an `https` link the app can download the installer from. Keep it private: the installer holds Aarakshak's model. Without a link, the app tells the officer to ask their nodal officer for the new version.
- `KHOZO_DESKTOP_LATEST_NOTES` (optional): one line on what changed.

With a link, the officer presses "Download the new version"; the app fetches it, checks its fingerprint, and on "Close Khozo Desktop and install" runs it. Checks on the laptop are kept and carry on afterwards.

### Checking a build end to end

```sh
KHOZO_DESKTOP_USERDATA=<scratch folder> KHOZO_DESKTOP_SMOKE=<folder for screenshots> \
KHOZO_SMOKE_CASE=<case id> KHOZO_SMOKE_VIDEO=<clip> KHOZO_SMOKE_CAMERA="<place>" KHOZO_SMOKE_START=<start> \
KHOZO_LOGIN=<officer> KHOZO_PASSWORD=<password> npx electron .
```

The run signs in, runs a real check against Khozo, and saves a screenshot of each screen. It then checks that the results, pictures, clip and full picture all show, and writes the outcome to `smoke.json`. `KHOZO_SMOKE_KEEP=1` keeps the job; `KHOZO_SMOKE_JOB=<id>` reopens a kept job without sending anything again.

## The command-line tools

### 1. Find the people in the footage

```sh
node bin/scan.mjs D:/footage/gate1.mp4 --out D:/scans/case-123
node bin/scan.mjs D:/footage/ --from 1:30:00 --to 3:30:00 --out D:/scans/case-123   # every video in a folder, one window
node bin/scan.mjs gate1.dav --max-side 1920 --frames                                   # small faces; keep the whole frame too
```

- `--from` and `--to` are times into each file, as `h:mm:ss`, `mm:ss` or seconds.
- `--fps 2` sets how often to look (two times a second by default).
- `--max-side 1280` or `1920` finds the small faces of a camera high on a wall, more slowly.
- `--frames` also saves the whole frame for each person, with the face boxed.
- `--json` prints one JSON line for each event, for the desktop app to read.

FFmpeg opens MP4, H.265, AVI, MKV, MPEG-TS, raw `.264`/`.265` streams and Dahua `.dav` files. A file that will not open is reported, and the other files carry on.

The output folder holds `manifest.json` and, for each file, `faces/t<id>.jpg`. Those are pictures of everyone seen, so delete the folder when the case work is done.

### 2. Compare with a case

```sh
set KHOZO_LOGIN=officer@example.gov.in
set KHOZO_PASSWORD=...
node bin/compare.mjs D:/scans/case-123 --case r_AbCdEf12 --camera "Kalupur railway station, gate 1" --recorded-from 2026-10-20T14:30:00
```

**Signing in.** Use the officer's own Khozo account and a police role, the same rule as the browser. You can also set `KHOZO_TOKEN` instead of a login and password. The password is never printed or saved.

**Recording start.** `--recorded-from` is when the recording starts, by the camera's clock. Answers then read in clock time. With several files, give one start for each file as `"<file name>=<start>"`. Many DVRs show the time on the picture but not in the file, so type it in.

**How faces are sent.** Faces go to `POST /reports/:id/video-search`, five in each request and the clearest first. Khozo compares them with Aarakshak and AWS Rekognition, keeps no picture, and audits each request.

**Limits and stops.** The run waits when Khozo's limit for one officer is reached: today 200 requests in 15 minutes, which is 1,000 faces. It also waits when the connection drops. Answers are saved after every request in `compare-<case>.json`, so a stopped run carries on from where it stopped.

**The review sheet.** `review-<case>.html` shows the faces to look at first, then everyone seen in slices of 15 minutes.

## The first pass with Aarakshak's model

Aarakshak recognises faces with ArcFace on a ResNet100 backbone. With **the same model and the same weights** on the laptop, everyone seen is compared with the case on the laptop first, and only the closest people are sent to Khozo:

- everyone at or above `--line` (0.25 by default, below Aarakshak's match line of 0.35);
- the `--top` closest (10 by default), whatever their score.

Passers-by's faces then stay on the laptop. Khozo's answer, from Aarakshak's cloud and AWS, is still the one that is recorded.

### How the laptop makes the same signatures

Each step follows the way Aarakshak makes a signature, so the laptop's scores are Aarakshak's scores:

1. Find faces with YuNet on the whole picture, at its own size. Khozo's `web/src/video/yunet-2026may.onnx` is the same YuNet network, built to take any picture size.
2. Take the face with the largest box.
3. Line it up the way OpenCV's `estimateAffinePartial2D` does with LMEDS, onto the ArcFace five-point template, in 112 x 112. That includes OpenCV's random numbers (`scanner/align.js`, checked against OpenCV's own answers in the tests).
4. Run the recognition model, then the adapter if the card names one (`scanner/npz.js` reads its `.npz` file).
5. Score: the cosine of two signatures.

Checked on the demo clip against Aarakshak's own scoring: the largest gap was under 0.002.

### Setting it up

The model files are Aarakshak's and are **not** in this repository; never copy them in (the folder's `.gitignore` refuses `.onnx` files). Write a card outside the repository, with the paths and settings Aarakshak runs in production, and set `KHOZO_FACE_MODEL` to its path:

```json
{ "name": "aarakshak-fr", "version": "<model and adapter version>", "provider": "Aarakshak",
  "model": "<path to the recognition model .onnx>",
  "adapter": "<path to the adapter .npz>", "fusionBaseWeight": 0,
  "detectorScore": 0.6,
  "input": { "size": 112, "channels": "bgr", "mean": 0, "std": 1, "layout": "nchw" } }
```

- **Name and version:** recorded with every score. Change the version whenever Aarakshak's model or adapter changes.
- **`detector` (optional):** points at a different YuNet file. Leave it out to use Khozo's copy.
- **With the card set, both tools use these settings:** `scan.mjs` finds faces with the card's threshold, and `compare.mjs` runs the first pass.

**Do not use ArcFace weights from anywhere else.** InsightFace's public weights may be used only for non-commercial research, and other weights give different scores.

For the case's own signature, the case's photos are read into memory and never saved. The signatures are dropped when the run ends.

## Speed measured

These figures are from 23 October 2026, on an Intel Core i7-10750H with 16 GB of memory and no graphics card used. The footage was made from the demo clip, with about five faces in view at a time. Real, busy footage needs measuring.

| Footage | Setting | Time | Times faster than real time | 10 hours would take |
| --- | --- | --- | --- | --- |
| 720p, 1 hour | normal (960) | 6 min 37 s | 9.1 | about 1 h 10 min |
| 1080p, 10 minutes | normal (960) | 1 min 31 s | 6.6 | about 1 h 30 min |
| 1080p, 10 minutes | far faces (1920) | 2 min 46 s | 3.6 | about 2 h 50 min |

Use `--gpu` to try DirectML on Windows laptops with a graphics card.
