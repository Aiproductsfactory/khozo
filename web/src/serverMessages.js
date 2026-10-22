// Fixed English sentences the API sends for the public pages to display
// (shared/case-domain.js publicCaseStatus / publicSightingStatus, and the
// sighting receipt in shared/routes/reports.js). The pages pass them through
// t(); listing them here is what lets `npm run i18n:check` see them. Keep in
// step with the server: a changed sentence simply shows in English.
//
// There are no public bulletins any more (shared/case-domain.js
// isPublicAppeal), so the bulletin wording that used to be listed here is
// gone; its translations stay in locales/*/server.json, unused.
import { msg } from './i18n.jsx';

export const SERVER_MESSAGES = [
  // Sighting receipt
  msg('Possible match found. Police will review before any identity or family details are shared.'),
  msg('No strong match yet. The report is saved and sent to Childline and the CWC for follow-up.'),
  msg('Your written report is saved and sent to Childline and the CWC. No face search was run because there was no photo.'),
  msg('Police review pending'),
  msg('Childline/CWC intake queued'),

  msg('Sent to Childline and the CWC'),
  msg('Referred to Childline/CWC'),
  msg('Formal found-child intake opened'),

  msg('Formal found-child case opened'),

  // Sighting status: one sentence per stage. The stage depends only on how
  // long ago the report was sent, never on what the engines or officers did
  // (shared/case-domain.js SIGHTING_STAGE_MESSAGES).
  msg('Your report has been received and is waiting for review by the responsible officers.'),
  msg('Your report is being reviewed by the responsible officers.'),
  msg('The review period for this report has ended. Thank you for reporting.'),
  msg('If the child appears to be in immediate danger, call 1098 or 112.'),

  // A refused publish (POST /api/reports/:id/bulletin with publish: true).
  msg('Public appeals are disabled on Khozo: names and photos of missing persons are never shown to the public.'),

  // A refused re-match (POST /api/reports/:id/rematch), shown in the console.
  msg('This case has no photo to compare with sightings'),
  msg('Cases whose details were removed are not compared with sightings'),
  msg('Found cases are not compared with sightings'),
  msg('Closed cases are not compared with sightings'),
  msg('A citizen or NGO report must be checked before it is compared with sightings'),

  // A refused video search (POST /api/reports/:id/video-search), shown in the console.
  msg('Cases whose details were removed cannot be searched for'),
  msg('This person has been found'),
  msg('This case is closed'),
  msg('A found-child case is not searched for in videos'),
  msg('A citizen or NGO report must be checked before it is searched for'),
  msg('This case has no photo to compare with'),
  msg('Searching a video is not available here'),
  msg('This search has no reference. Start the search again.'),
  msg('Send at least one face picture'),
  msg('The case photo could not be read'),
  msg('No face engine is set up, so the faces could not be compared'),

  // Why a re-match compared no faces (the engine's `note` in the
  // /api/reports/:id/rematch answer, shown in the console).
  msg('No face-matching service answered, so no faces were compared and no possible match is shown.'),
  msg('No stored sighting photos to compare against, so no face comparison was possible.'),
  msg('The comparison could not be completed.'),
  msg('The case photo could not be read.'),
  msg('The case has no photo to compare.'),
  msg('Reverse matching is not available on this runtime.'),

  // Case status
  msg('Citizen/NGO intake pending verification'),

  msg('Citizen or NGO report waiting to be checked'),
  msg('Missing case active'),
  msg('Under official review'),
  msg('Found / traced'),
  msg('Case closed'),
  msg('Status under review'),
  msg('The case is active with the responsible agency.'),
  msg('The child has been marked found or traced by an authorized agency.'),
  msg('The case has been closed by an authorized agency.'),
  msg('The case is saved for official review.'),
  msg('If you have information, submit a sighting or contact 1098 / 112.'),
  msg('For urgent concerns, contact the responsible police/CWC desk or emergency helplines.'),

  // Missing women and adult persons (shared/case-domain.js publicHelplineText
  // and the category-aware sighting messages).
  msg('Thank you. Your report has reached the police and child-protection desks for this area. Keep your receipt number to track it.'),
  msg('Received for review'),
  msg('Police intake queued'),

  msg('Sent to the police'),
  msg('No strong match yet. The report is saved and sent to the police for follow-up.'),
  msg('Your written report is saved and sent to the police. No face search was run because there was no photo.'),
  msg('If she appears to be in immediate danger, call 112. The Women Helpline 181 and the One Stop Centre (Sakhi) can also help.'),
  msg('If the person appears to be in immediate danger, call 112.'),
  msg('The person has been traced by an authorized agency. Any contact is arranged only with their consent.'),
  msg('If you have information, submit a sighting or contact 112 / Women Helpline 181.'),
  msg('If you have information, submit a sighting or contact 112.'),
  msg('Women Helpline'),

  // A field sent with the wrong shape (readFields in shared/case-domain.js).
  // The server sends "Invalid value for <field>" with the field's name; the
  // template lets a page translate it as t('Invalid value for {field}', { field }).
  msg('Invalid value for {field}'),

  // Confirming a match (POST /api/reports/found/:id/review with decision
  // 'matched', POST /api/reports/:id/confirm-match) needs `verification`.
  msg('Record how the identity was verified before confirming'),
  msg('In person'),
  msg('Video call'),
  msg('Match confirmed'),

  // Reopening a case (POST /api/reports/:id/reopen).
  msg('Only a found or closed case can be reopened'),
  msg('A case whose details were removed cannot be reopened'),
  msg('Give a reason of at least 10 characters for reopening the case'),
  msg('Case reopened'),
  msg('This report is outside your area'),

  // Telling the family (POST /api/reports/:id/send-sms, the `familyMessage`
  // of confirm-match, POST /api/reports/:id/family-contacted).
  msg('SMS sent to the family.'),
  msg('No SMS service is connected. Call the family directly and record the call.'),
  msg('The SMS service did not accept the message. Call the family directly and record the call.'),
  msg('No family phone number is recorded on this case. Record how the family was contacted.'),
  msg('The family has not been told yet. Call them and record the call.'),
  msg('Verify with the person first; share their location with the family only with their consent'),
  msg('A citizen or NGO report must be checked before the family is sent an SMS'),
  msg('Contact method must be call, visit or sms'),
  msg('Phone call'),
  msg('Visit'),
  msg('Family contacted'),

  // Provisioning an account (POST /api/dashboard/network/users).
  msg('A district is required for this role'),
  msg('A state is required for this role'),
  msg('You cannot create accounts for that area'),
  msg('You cannot create an account with this role'),

  // Looking up a sighting's street address (POST /api/reports/found/:id/address).
  msg('This sighting has no location to look up'),
  msg('The address could not be found. Open the location in Maps instead.'),

  // An officer's correction of a photo's face screen (POST /api/reports/found/:id/screening).
  msg('This sighting has no photo'),
  msg('Say whether the photo shows a person'),
];
