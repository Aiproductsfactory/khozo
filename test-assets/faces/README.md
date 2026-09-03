# Face-match test fixtures

Photographs used by `npm run test:images` to prove the sighting pipeline end to
end: a case is registered from one photo of a person, a sighting is submitted
using a *different* photo of the same person, and the test asserts the two are
matched to each other and to nobody else.

## Naming

The filename carries the identity the test checks. There is no list to keep in
sync — the test reads the folder.

```
<subject>-1.jpg     first photo of a person; the case is registered from this one
<subject>-2.jpg     further photos of the same person; submitted as sightings
<subject>-3.jpg     the test asserts each of these matches <subject>'s case
control-1.jpg       a person with no registered case; a match here is a false positive
```

`<subject>` can be anything without a trailing `-<number>`: `subject-a`,
`demo-child`, `rahul`. Two or more photos per subject are required — a subject
with a single photo gives the matcher nothing to search with.

Controls are worth adding. Without them the run only proves the matcher says
"yes" often enough, not that it says "no" when it should.

## Optional case details

Drop a `subjects.json` next to the images to control how each case is
registered:

```json
{
  "subject-a": {
    "childName": "Aarav Sharma",
    "age": 12,
    "gender": "Male",
    "parentName": "Nisha Sharma",
    "parentPhone": "9820011221",
    "district": "Mumbai",
    "zip": "400050",
    "address": "Bandra West, Mumbai"
  }
}
```

Anything you leave out is filled in with a placeholder.

## These images are not committed

`.gitignore` excludes the image files in this folder, and only this README is
tracked. The repository is public, and the fixtures are photographs of real
people's faces: committing them would publish biometric data of an identifiable
person, permanently and to anyone. Keep them local, or store them somewhere with
access control and the subject's consent.

For the same reason, never use a photograph of an actual missing child as a
fixture, and never commit an identity document — a scan of an ID card carries a
living person's name, address and number in one file.

## Running

The public sighting endpoint is rate limited, so raise the limit for the run:

```bash
KHOZO_FOUND_REPORT_LIMIT=500 npm run dev:server     # in one terminal
npm run test:images                                  # in another
```

Against a deployed API instead:

```bash
npm run test:images -- --api https://khozo.swastik-kumar.workers.dev
```
