import { msg } from './i18n.jsx';

// What the form and the review desk call the reasons in
// shared/sighting-misuse.js, registered for translation.

/** Why the reporter thought a woman or an adult needs help, in the order the form asks. */
export const CONCERN_REASON_LABELS = {
  asked_for_help: msg('Asked for help'),
  lost_or_confused: msg('Seems lost or confused'),
  hurt_or_unwell: msg('Seems hurt or unwell'),
  held_against_will: msg('Seems to be held against their will'),
  other: msg('Something else (say what in the note)'),
};

/** An officer's reasons for closing a sighting as "Not a concern". */
export const DISMISSAL_OPTIONS = [
  { id: 'not_a_concern', label: msg('Not a concern: the person is not missing and not in need') },
  { id: 'misuse', label: msg('Misuse: the photo was not taken to help anyone') },
];
