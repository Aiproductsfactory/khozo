# Khozo Desktop: long CCTV footage, checked on the laptop

The police check CCTV footage of 30 minutes to 10 hours, from one camera or many. The browser's **Check CCTV video** button handles short clips. This folder is the start of the desktop version of Khozo for long footage.

The video stays on the officer's computer. Only small face pictures, their moments, the camera's place and the file's fingerprint (SHA-256) are sent to Khozo. Every result is a lead for an officer to check, never an identification.

This is **Phase 0**: two command-line tools to measure the method on real footage before the desktop window is built.

| Tool | What it does | Sends anything? |
| --- | --- | --- |
| `bin/scan.mjs` | Reads the footage with FFmpeg, finds faces with YuNet (the face finder Aarakshak uses), follows each person from frame to frame and keeps one clear picture of each | No |
| `bin/compare.mjs` | Compares those people with one case on Khozo, through the same route the browser uses, and writes a review sheet | Face pictures only |

The scanner reuses the browser's own code: `web/src/video/faces.js` (face boxes, tracking, picture quality) and the YuNet model file `web/src/video/yunet-2026may.onnx`.

## Install

```sh
cd desktop
npm install        # once, with internet: FFmpeg, the ONNX runtime and sharp
npm test           # 38 checks, no real case or face needed
```

The scanner is a separate package so that the Worker build never downloads FFmpeg.

## 1. Find the people in the footage

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

## 2. Compare with a case

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

The model is Aarakshak's and is **not** in this repository. When Aarakshak delivers it, put the `.onnx` file anywhere outside the repository and set `KHOZO_FACE_MODEL` to its path. Beside it, put a card with the same name and `.json` at the end:

```json
{ "name": "aarakshak-fr", "version": "1.82", "provider": "Aarakshak",
  "input": { "size": 112, "channels": "rgb", "mean": 127.5, "std": 127.5, "layout": "nchw" } }
```

The card's name and version are recorded with every score. The `input` block must say exactly how Aarakshak prepares a face. Faces are lined up with the standard five-point ArcFace template (`scanner/align.js`). If Aarakshak lines faces up differently, change `align.js` to match.

**Do not use ArcFace weights from anywhere else.** InsightFace's public ResNet100 weights may be used only for non-commercial research. Their scores would also not match Aarakshak's, even with the same architecture.

For the case's own signature, the case's photos are read into memory and never saved. The signatures are dropped when the run ends.

## Speed measured

These figures are from 23 October 2026, on an Intel Core i7-10750H with 16 GB of memory and no graphics card used. The footage was made from the demo clip, with about five faces in view at a time. Real, busy footage needs measuring.

| Footage | Setting | Time | Times faster than real time | 10 hours would take |
| --- | --- | --- | --- | --- |
| 720p, 1 hour | normal (960) | 6 min 37 s | 9.1 | about 1 h 10 min |
| 1080p, 10 minutes | normal (960) | 1 min 31 s | 6.6 | about 1 h 30 min |
| 1080p, 10 minutes | far faces (1920) | 2 min 46 s | 3.6 | about 2 h 50 min |

Use `--gpu` to try DirectML on Windows laptops with a graphics card.
