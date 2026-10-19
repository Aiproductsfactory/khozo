// Keeping the public sighting form from becoming a way to photograph
// strangers, women and girls above all.
//
// Two records:
//
//   concernReason  why the reporter thought a woman or an adult needs help,
//                  asked on the form before a report of an adult is sent. An
//                  adult has the right to be left alone, and a photo of a
//                  stranger who is fine is a photo of someone who is not
//                  missing. Recorded when given; never required by the
//                  server, so a page cached before the question existed, or
//                  a report waiting in a phone's offline queue, still arrives.
//
//   dismissal      an officer's "Not a concern": the sighting is closed and its
//                  photo deleted at once (POST /found/:id/dismiss). "Misuse"
//                  says the photo was not taken to help anyone; it is counted
//                  in the MIS report and raised in the public-abuse queue.

export const CONCERN_REASONS = Object.freeze({
  asked_for_help: 'Asked for help',
  lost_or_confused: 'Seems lost or confused',
  hurt_or_unwell: 'Seems hurt or unwell',
  held_against_will: 'Seems to be held against their will',
  other: 'Something else',
});

export const DISMISSAL_REASONS = Object.freeze({
  not_a_concern: 'Not a concern',
  misuse: 'Misuse',
});

const known = (table) => (value) => {
  const key = typeof value === 'string' ? value.trim() : '';
  return Object.hasOwn(table, key) ? key : null;
};

/** A concern reason the form offers, or null. */
export const concernReasonOf = known(CONCERN_REASONS);

/** A dismissal reason, or null. */
export const dismissalReasonOf = known(DISMISSAL_REASONS);

/** The approval reference an anonymised, dismissed sighting carries (kept by anonymisation). */
export const dismissalApproval = (reason) => `dismissed:${reason}`;
