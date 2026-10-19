// Fixed English sentences the API sends about matching, photos and uploads,
// for the console to show through t(): the refusals of the candidate, search,
// placement and photo routes (shared/routes/reports.js, shared/routes/
// matching-admin.js), the photo checks (shared/case-domain.js
// validateImageFile) and the engine's notes (shared/match-pipeline.js,
// shared/sighting-matching.js). Listing them here is what lets
// `npm run i18n:check` see them; translations are in
// locales/*/matching.json. Keep in step with the server: a changed sentence
// simply shows in English.
//
// Kept apart from serverMessages.js so the two can change independently.
import { msg } from './i18n.jsx';

export const SERVER_MESSAGES_MATCHING = [
  // Uploads (both runtimes refuse these the same way).
  msg('Photo is larger than 8 MB. Choose a smaller photo or retake it.'),
  msg('The upload could not be read'),
  msg('Photo must be a JPG, PNG, or WebP image'),
  msg('Child photo must be a JPG, PNG, or WebP image'),
  msg('Sighting photo must be a JPG, PNG, or WebP image'),
  msg('Photo does not look like a JPG, PNG or WebP image'),
  msg('Child photo does not look like a JPG, PNG or WebP image'),
  msg('Sighting photo does not look like a JPG, PNG or WebP image'),
  msg('Photo consent is required before uploading a child image'),

  // Searching a sighting again (POST /api/reports/found/:id/rematch).
  msg('This sighting has no photo to compare'),
  msg('Sightings whose details were removed are not compared with cases'),
  msg('This sighting is closed and is not searched again'),
  msg('The sighting photo could not be read.'),
  msg('The sighting changed while it was being compared. Open it again.'),

  // Placing a sighting (POST /api/reports/found/:id/place).
  msg('Give the state and the district the sighting belongs to'),
  msg('You can place a sighting only in your own state'),
  msg('A closed sighting cannot be placed'),

  // Replacing a case photo (POST /api/reports/:id/photo).
  msg('A case whose details were removed cannot be given a new photo'),
  msg('Attach the new photo'),
  msg('The photo could not be stored. Try again.'),

  // Confirming a case with a named sighting, and the reverse search.
  msg('That sighting is not linked to this case'),
  msg('A found-child case is not compared with sightings'),
  msg('A found-child case is compared with missing cases as they are registered, not with sightings.'),

  // Why a search compared no faces (the engine's `note`).
  msg('No face could be found in the photo, so no comparison was possible.'),
];
