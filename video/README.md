# Khozo explainer video

A short animated film that tells the public what to do when they see someone who seems lost, and what happens to the photo they send. It is drawn with [Remotion](https://www.remotion.dev/), so every word, number and colour is a setting: the same film serves Ahmedabad today, another state tomorrow, and another country later. No real person, child or face is ever shown; every picture is a shape.

Six scenes, 25 seconds:

| Seconds | Scene | What the viewer sees |
| --- | --- | --- |
| 0–4 | See | A child alone on a platform at dusk. "Seen a child, woman or person who seems lost?" |
| 4–8 | Danger | A phone ringing 112. "In danger? Call 112 first." The other helplines beneath. |
| 8–13 | Send | The report form on a phone: a photo, a place, Send. "No danger? Send a photo, or just the place, to the police." |
| 13–17 | Only the police | The photo travels from the phone to a shield with a lock, past two crossed-out chat bubbles. "Only the police see it. Free. No login. Your name is optional." |
| 17–20 | Don't forward | A chat bubble with a forward arrow, crossed out. "Never forward the photo." |
| 20–25 | Motto | "See it. Send it to the police. Don't forward it." in each language, the address, the helplines, the issuer and the Khozo logo. |

Two cuts of the same film: **Vertical** (1080 × 1920) for WhatsApp Status, Instagram Reels and YouTube Shorts, and **Landscape** (1920 × 1080) for cinema slides, YouTube and screens at stations.

## Render it

```
cd video
npm install
npm run render          # both cuts, into out/
npm run render:vertical # one cut
npm run studio          # preview and scrub in the browser
```

The first run downloads a headless browser (about 240 MB). Rendering fetches the Noto Sans, Noto Sans Gujarati and Noto Sans Devanagari faces from Google Fonts, so the machine needs the internet; it does not need those fonts installed.

The film has no sound. Record the voice in the primary language reading the six lines in `src/props.ts`, and add it in any editor, or with Remotion's `<Audio>` if you want it rendered in.

## Adapt it for another police force, state or country

Everything that changes is in one object: who issues it, the address, the emergency number, the other helplines, and the lines in each language. Write a JSON file and pass it with `--props`:

```json
{
  "issuer": "Mumbai Police",
  "url": "khozo.org/report",
  "emergency": "112",
  "helplines": [{ "label": "Child", "number": "1098" }, { "label": "Woman", "number": "103" }],
  "primary": {
    "code": "mr", "script": "devanagari",
    "see": "…", "danger": "…", "send": "…", "onlyPolice": "…", "dontForward": "…", "motto": "…"
  },
  "secondary": { "code": "en", "script": "latin", "see": "…", "danger": "…", "send": "…", "onlyPolice": "…", "dontForward": "…", "motto": "…" }
}
```

```
npx remotion render src/index.ts Vertical out/mumbai-vertical.mp4 --props=mumbai.json
```

- `{emergency}` in any line becomes the emergency number.
- `secondary` may be `null` for a film in one language.
- `script` picks the font: `latin`, `gujarati` or `devanagari`. To add another script (Bengali, Tamil, Arabic…), add one line to `src/fonts.ts`.
- `colours` overrides the brand colours for a force that wants its own.

English, Gujarati and Hindi lines are in `src/props.ts`. A native speaker checks every line before the film is issued; the lines must match the posters and the website word for word.

## Rules the film keeps

- No real child, missing person or face: shapes only. A film about missing children must not put a child's face in front of the public (Juvenile Justice Act, s.74).
- The emergency number comes before the website, every time.
- The address is printed, never a QR code: a code is for paper.
- "Don't forward" is said in every cut.
- No fear: no "child-lifting", no abduction scene, nobody shown as a suspect.
