// Which poster, card or sticker a sighting came from, when the reporter opened
// the form by scanning its code: https://khozo.org/report?src=kalupur.
//
// The tag names a place where a poster hangs, chosen by the department that
// printed it, never a person. It is only ever counted: the MIS report's
// "Sightings by poster code" says which posters bring reports in. It names a
// spot finer than a district, so anonymising a sighting clears it along with
// the place (shared/privacy.js keeps only SIGHTING_KEEP).
//
// Anything that is not a short lowercase slug is dropped, never refused: a
// mistyped or tampered code must not stop a report from being sent.

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** The poster code in a canonical form, or null when there is none or it is malformed. */
export function campaignSourceOf(value) {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return SLUG.test(slug) ? slug : null;
}
