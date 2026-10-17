// The last mile of a case: confirming that a person has been found, telling
// the family, and undoing a confirmation that turns out to be wrong.
//
// A confirmation used to be one click on a percentage, and the button promised
// an SMS that no gateway ever sent. Now:
//
//   - Confirming opens ConfirmMatchDialog: both photographs large and uncropped,
//     and a verification record (how identity was checked, by whom, where) that
//     the server requires before it marks anything found.
//   - Telling the family is something the officer does — a call or a visit —
//     and then records (FamilyContactPanel). Khozo never claims a message went
//     out that it cannot prove went out.
//   - A wrong confirmation can be taken back, with a reason (ReopenCasePanel).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { asList, fmtDate, isAdultCase, personCategoryOf, ProtectedImage, txt, genderLabel } from '../lib.jsx';
import { currentLocale, msg, useT } from '../i18n.jsx';
import { expectedAgeAt } from '../../../shared/match-pool.js';
import { WEAK_FACE_WARNINGS } from '../../../shared/face-index.js';
import { useDisplay } from '../useDisplay.js';
import { useBackClose } from '../useBackClose.js';
import { ActionMessage } from './useAction.jsx';

export const VERIFICATION_METHODS = [
  { id: 'in_person', label: msg('In person') },
  { id: 'video_call', label: msg('Video call') },
  { id: 'documents', label: msg('Identity documents') },
  { id: 'other', label: msg('Other') },
];

const FAMILY_METHODS = [
  { id: 'call', label: msg('Phone call') },
  { id: 'visit', label: msg('Home visit') },
];

const CONTACT_METHOD_LABELS = {
  call: msg('Phone call'),
  visit: msg('Home visit'),
  sms: msg('SMS'),
};

/** The success line for a confirmation; the family is never told by Khozo. */
export function confirmedMessage(record) {
  return isAdultCase(record)
    ? msg('Verification recorded and the case is marked found. No one has been told.')
    : msg('Verification recorded and the case is marked found. The family has not been told yet: call them now.');
}

/** The rule the server applies to body.verification. */
export function verificationValid(v) {
  return (
    VERIFICATION_METHODS.some((m) => m.id === v.method) &&
    v.verifiedBy.trim().length >= 2 &&
    v.place.trim().length >= 2 &&
    v.note.trim().length >= 10
  );
}

export function telHref(phone) {
  const digits = txt(phone).replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

// ---- The evidence behind a match ------------------------------------------------
//
// What an officer weighs before confirming: both engines' numbers and whether
// they agree, whether the second engine looked at all, how good the photos
// are, and whether the person in the sighting could be the person in the case
// - the age they would be now, sex, when they went missing, the marks to look
// for. Officers only; the public is shown none of this.

const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

/** Human words for the quality codes an engine attaches to a photo. */
const QUALITY_WARNINGS = {
  no_face_detected: msg('No face was found in one of the photos'),
  low_detector_confidence: msg('The face was hard to make out'),
  blurry: msg('The photo is blurred'),
  blur: msg('The photo is blurred'),
  low_resolution: msg('The photo is small or low-resolution'),
  small_face: msg('The face is small in the photo'),
  occluded: msg('The face is partly covered'),
  extreme_pose: msg('The face is turned away'),
  poor_lighting: msg('The lighting is poor'),
};

/** Why the second engine did not check a candidate. */
const NOT_CHECKED_REASONS = {
  no_answer: msg('Not checked by AWS Rekognition: it did not answer.'),
  unsupported_format: msg('Not checked by AWS Rekognition: it cannot read this photo format (WebP).'),
  too_large: msg('Not checked by AWS Rekognition: the photo is larger than it accepts.'),
  no_face: msg('Not checked by AWS Rekognition: it found no face in one of the photos.'),
};

/**
 * Whether a case photo can be matched (`photoCheck` from the server), as a
 * flag for the case, or null when it is usable or was never checked.
 */
export function photoCheckFlag(photoCheck) {
  if (!photoCheck || typeof photoCheck !== 'object') return null;
  if (photoCheck.verdict === 'no_face') {
    return { label: msg('Photo not usable for matching: no face was found in it'), className: 'bg-red-50 text-red-700 ring-red-200' };
  }
  if (photoCheck.verdict === 'multiple_faces') {
    return { label: msg('Group photo — use a photo of the person alone'), className: 'bg-amber-50 text-amber-800 ring-amber-200' };
  }
  if (photoCheck.verdict === 'unchecked') {
    return { label: msg('Photo not yet checked for a face'), className: 'bg-slate-100 text-slate-600 ring-slate-200' };
  }
  return null;
}

const FACE_INDEX_REFUSALS = {
  no_face: msg('Face search gallery: no face was found in this photo'),
  face_not_found_at_box: msg('Face search gallery: no face was found in this photo'),
  multiple_faces: msg('Face search gallery: several faces in this photo — use a photo of the person alone'),
  face_too_small: msg('Face search gallery: the face is too small — use a closer, sharper photo'),
  photo_missing: msg('Face search gallery: the photo file could not be read — upload it again'),
};

/**
 * What the face search gallery (shared/face-index.js) made of a case's photo,
 * when the desk should know: it refused it - the case is then searched only
 * pairwise, a few cases at a time - or took it with a face too small or
 * unclear to match reliably. Replacing the photo enrols the new one.
 */
export function faceIndexFlag(faceIndex) {
  if (!faceIndex || typeof faceIndex !== 'object') return null;
  if (faceIndex.status === 'enrolled') {
    return Array.isArray(faceIndex.warnings) && faceIndex.warnings.some((w) => WEAK_FACE_WARNINGS.has(w))
      ? { label: msg('In the face search gallery, but the face is small or unclear — a larger, sharper photo will match better'), className: 'bg-slate-100 text-slate-700 ring-slate-200' }
      : null;
  }
  if (faceIndex.status !== 'failed') return null;
  const reason = String(faceIndex.reason || '');
  const label = FACE_INDEX_REFUSALS[reason]
    || (reason.startsWith('refused_') || /^http_4\d\d$/.test(reason) ? msg('Face search gallery refused this photo — use a clearer, larger photo of the face') : null);
  return label ? { label, className: 'bg-amber-50 text-amber-800 ring-amber-200' } : null;
}

/**
 * The candidate a sighting currently points at: its entry in the candidate
 * list, or, for a record from before candidates were kept, one rebuilt from
 * the sighting's own score fields.
 */
export function currentCandidate(sighting) {
  if (!sighting || typeof sighting !== 'object') return null;
  const list = asList(sighting.matchCandidates).filter((c) => c && typeof c === 'object');
  const found = list.find((c) => c.reportId === sighting.matchedReportId);
  if (found) return found;
  if (!sighting.matchedReportId && sighting.matchScore == null) return null;
  return {
    reportId: sighting.matchedReportId || null,
    score: Number(sighting.matchScore) || 0,
    aarakshakScore: sighting.primaryScore ?? null,
    rekognitionScore: sighting.secondOpinionScore ?? null,
    corroborated: sighting.matchCorroborated ?? sighting.secondOpinion === 'agrees',
    notChecked: Boolean(sighting.matchNotChecked),
    secondOpinion: sighting.secondOpinion || null,
    enginesDisagree: sighting.enginesDisagree ?? null,
    warnings: sighting.photoQualityWarnings || null,
  };
}

/** Each engine's number and what it means, as chips. */
export function EngineScores({ candidate, provider = '' }) {
  const t = useT();
  if (!candidate) return null;
  const chips = [];
  if (candidate.aarakshakScore != null) {
    chips.push({ key: 'a', text: t('Aarakshak {pct}', { pct: pct(candidate.aarakshakScore) }), className: 'bg-white text-slate-700 ring-slate-200' });
  } else if (candidate.secondOpinion === 'sole_engine') {
    chips.push({ key: 'a', text: t('Aarakshak: no face found'), className: 'bg-white text-slate-500 ring-slate-200' });
  }
  if (candidate.rekognitionScore != null) {
    chips.push({ key: 'r', text: t('AWS Rekognition {pct}', { pct: pct(candidate.rekognitionScore) }), className: 'bg-white text-slate-700 ring-slate-200' });
  }
  if (candidate.corroborated) {
    chips.push({ key: 'c', text: t('Both engines agree'), className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' });
  } else if (candidate.notChecked) {
    chips.push({ key: 'n', text: t('Not checked by a second engine'), className: 'bg-amber-50 text-amber-800 ring-amber-200' });
  } else if (candidate.secondOpinion === 'sole_engine') {
    chips.push({ key: 's', text: t('One engine only'), className: 'bg-amber-50 text-amber-800 ring-amber-200' });
  } else if (['unavailable', 'not_asked', 'no_answer'].includes(candidate.secondOpinion)) {
    chips.push({ key: 'u', text: t('Not corroborated by a second engine'), className: 'bg-amber-50 text-amber-800 ring-amber-200' });
  }
  if (candidate.enginesDisagree) {
    chips.push({ key: 'd', text: t('The engines disagree — look closely'), className: 'bg-red-50 text-red-700 ring-red-200' });
  }
  if (!chips.length && provider) chips.push({ key: 'p', text: provider, className: 'bg-white text-slate-600 ring-slate-200' });
  return (
    <span className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${chip.className}`}>{chip.text}</span>
      ))}
    </span>
  );
}

/**
 * The evidence panel: engines, flags, photo quality, and the sighting set
 * beside the case. `report` is the case as the review queue describes it
 * (expectedAge, gender, dateOfMissing, identificationMark, birthMark,
 * photoCheck); any field may be missing.
 */
export function MatchEvidence({ sighting, candidate = null, report = null }) {
  const t = useT();
  const d = useDisplay();
  const c = candidate || currentCandidate(sighting);
  const warnings = [...new Set([...asList(c?.warnings), ...asList(sighting?.photoQualityWarnings)].map(txt).filter(Boolean))];
  const flag = photoCheckFlag(report?.photoCheck);
  const reason = c?.notChecked ? NOT_CHECKED_REASONS[txt(c.notCheckedReason)] || NOT_CHECKED_REASONS.no_answer : null;
  const category = personCategoryOf(report || sighting);
  const age = (n) => (n != null && txt(n) !== '' ? t('about {n}', { n: txt(n) }) : t('not given'));
  // The age the person would be when the sighting was taken: their age when
  // they went missing plus the years since (the review queue sends it; a full
  // case record is worked out here the same way, shared/match-pool.js).
  const expected = report ? report.expectedAge ?? expectedAgeAt(report, sighting?.createdAt || Date.now()) : null;
  let caseAge = '';
  if (report) {
    if (expected == null) caseAge = age(report.age);
    else if (report.age != null && Number(expected) !== Number(report.age)) {
      caseAge = t('about {n} now (was {age} when missing)', { n: txt(expected), age: txt(report.age) });
    } else caseAge = age(expected);
  }
  const marks = report
    ? [
        d(report.identificationMark ?? report.identificationProfile?.identificationMark),
        d(report.birthMark ?? report.identificationProfile?.birthMark),
      ].filter(Boolean).join(' · ')
    : '';
  const rows = report
    ? [
        [t('Age'), age(sighting?.ageApprox), caseAge],
        [t('Sex'), genderLabel(txt(sighting?.gender), category) || t('not given'), genderLabel(txt(report.gender), category) || t('not given')],
        [t('Missing since'), '', report.dateOfMissing ? fmtDate(report.dateOfMissing) : t('not given')],
        [t('Identification marks'), '', marks || t('none recorded')],
      ]
    : [];
  return (
    <div className="space-y-2 text-left">
      {c && <EngineScores candidate={c} />}
      {reason && <p className="text-xs text-amber-800">{t(reason)} {t('Treat it as a lead from one engine; it has not been confirmed.')}</p>}
      {c?.secondOpinion === 'sole_engine' && (
        <p className="text-xs text-amber-800">{t('Aarakshak could not find a face in this pair, so AWS Rekognition compared it on its own.')}</p>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-100">
          <p className="font-semibold">{t('Photo quality')}</p>
          <ul className="mt-0.5 list-disc pl-4">
            {warnings.map((w) => <li key={w}>{QUALITY_WARNINGS[w] ? t(QUALITY_WARNINGS[w]) : w}</li>)}
          </ul>
        </div>
      )}
      {flag && <p className={`rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${flag.className}`}>{t(flag.label)}</p>}
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-2 font-semibold" />
              <th className="py-1 pr-2 font-semibold">{t('Sighting')}</th>
              <th className="py-1 font-semibold">{t('Case')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, seen, missing]) => (
              <tr key={label} className="border-t border-slate-100 align-top">
                <td className="py-1 pr-2 font-semibold text-slate-500">{label}</td>
                <td className="py-1 pr-2 text-slate-700">{seen || '—'}</td>
                <td className="py-1 text-slate-900">{missing || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PhotoPane({ label, src, empty, caption, tone = 'slate' }) {
  return (
    <figure className="min-w-0">
      {/* Two lines tall on a phone, so the two photographs start level when one label wraps. */}
      <figcaption className={`mb-1.5 min-h-[2lh] text-xs font-semibold sm:min-h-0 ${tone === 'indigo' ? 'text-indigo-700' : 'text-slate-600'}`}>{label}</figcaption>
      {/* Uncropped: a square crop cut off the very features being compared. */}
      <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 sm:h-80">
        <ProtectedImage
          src={src}
          alt={label}
          className="max-h-full max-w-full object-contain"
          fallback={<span className="px-3 text-center text-xs text-slate-400">{empty}</span>}
        />
      </div>
      {caption && <p className="mt-1.5 text-xs text-slate-600">{caption}</p>}
    </figure>
  );
}

/**
 * The only way a case is marked found from the console.
 *
 * `report` is the case; `sighting` the sighting that matched it, or null for
 * a person recovered in person with no sighting behind it. `onSubmit` receives
 * the verification record and performs the request; it must throw when the
 * server refuses, and the reason then shows here, inline. `action` is the
 * page's useAction(), so its success toast outlives the dialog.
 */
export function ConfirmMatchDialog({ report, sighting, action, onSubmit, onCancel }) {
  const t = useT();
  const d = useDisplay();
  const user = useAuth()?.user;
  const [v, setV] = useState({ method: 'in_person', verifiedBy: '', place: '', note: '' });
  const subject = report || sighting;
  const adult = isAdultCase(subject);
  const recovery = !sighting;
  const valid = verificationValid(v);
  const busy = action.busy('confirm');

  // The phone's Back button backs out too.
  useBackClose(true, onCancel);

  // Escape backs out, as it does from any dialog; never while saving.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const set = (key) => (e) => setV((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = () => {
    if (!valid || busy) return;
    action.run(
      'confirm',
      () => onSubmit({
        method: v.method,
        verifiedBy: v.verifiedBy.trim(),
        place: v.place.trim(),
        note: v.note.trim(),
      }),
      confirmedMessage(subject)
    );
  };

  const sightingSrc = sighting ? txt(sighting.photoUrl) || (sighting.id ? `/api/reports/photo/${sighting.id}` : null) : null;
  const caseSrc = report ? txt(report.photoUrl) || (report.id ? `/api/reports/photo/${report.id}` : null) : null;
  const score = sighting ? Math.round((Number(sighting.matchScore) || 0) * 100) : 0;

  /*
    On a phone the dialog is the whole screen: the two photographs side by
    side at the top, the verification form under them, and the confirm button
    held at the bottom edge so it is never scrolled out of reach.
  */
  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-match-title">
      <div className="animate-sheet-in card h-full max-h-[100dvh] w-full max-w-3xl space-y-5 overflow-y-auto overscroll-contain rounded-none bg-white px-4 pb-0 pt-0 shadow-2xl sm:h-auto sm:max-h-[94vh] sm:animate-none sm:rounded-2xl sm:px-6">
        <div className="sticky top-0 z-10 -mx-4 flex items-start justify-between gap-3 border-b bg-white px-4 pb-3 pt-4 sm:-mx-6 sm:px-6 sm:pt-6">
          <div>
            <h3 id="confirm-match-title" className="text-lg font-bold text-gray-900">
              {recovery ? t('Record an in-person recovery') : t('Confirm the match')}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {adult
                ? t('This marks the case as found. No one is alerted automatically.')
                : t('This marks the case as found. The family is not told automatically: you call them next.')}
            </p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label={t('Close')} className="text-lg font-bold text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>

        <div className={`grid gap-2 sm:gap-4 ${recovery ? 'mx-auto w-full max-w-md' : 'grid-cols-2'}`}>
          {!recovery && (
            <PhotoPane
              label={t('Sighting photo')}
              src={sightingSrc}
              empty={t('No sighting photo')}
              caption={txt(sighting.foundLocation)}
            />
          )}
          <PhotoPane
            label={adult ? t('Missing person record') : t('Missing child record')}
            src={caseSrc}
            empty={t('No case photo')}
            tone="indigo"
            caption={report ? [
              d(report.childName),
              report.id ? t('Case #{id}', { id: txt(report.id) }) : '',
              [genderLabel(txt(report.gender), personCategoryOf(report)), report.age != null && txt(report.age) ? t('age {age}', { age: txt(report.age) }) : '']
                .filter(Boolean).join(' / '),
            ].filter(Boolean).join(' · ') : ''}
          />
        </div>

        {recovery ? (
          <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-100">
            {t('No sighting is linked to this case. Confirming records that the person was found and their identity verified in person.')}
          </p>
        ) : (
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-center ring-1 ring-slate-200">
            <span className="block text-xs font-semibold text-slate-600">{t('Face similarity')}</span>
            <span className="text-2xl font-extrabold text-slate-900">{score}%</span>
            <span className="mt-1 block text-xs text-slate-500">
              {adult
                ? t('A score is a prompt to look. You are confirming this is the same person. Verify with them before anyone else is told.')
                : t('A score is a prompt to look. You are confirming this is the same child.')}
            </span>
            {/* Both engines, the flags, and the two descriptions side by side. */}
            <div className="mt-3 border-t border-slate-200 pt-3">
              <MatchEvidence sighting={sighting} report={report} />
            </div>
          </div>
        )}

        {adult && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            {t('Verify with the person first; share their location with the family only with their consent.')}
          </p>
        )}

        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-800">{t('Identity verification')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">{t('How was identity verified?')}</span>
              <select className="field w-full" value={v.method} onChange={set('method')} disabled={busy}>
                {VERIFICATION_METHODS.map((m) => <option key={m.id} value={m.id}>{t(m.label)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">{t('Verified by (name and rank)')}</span>
              <input className="field w-full" value={v.verifiedBy} onChange={set('verifiedBy')} placeholder={txt(user?.name)} disabled={busy} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">{t('Where it was verified')}</span>
              <input
                className="field w-full"
                value={v.place}
                onChange={set('place')}
                placeholder={txt(sighting?.foundLocation) || t('Police station, hospital, shelter…')}
                disabled={busy}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">{t('How identity was confirmed')}</span>
              <textarea
                className="field min-h-24 w-full"
                value={v.note}
                onChange={set('note')}
                placeholder={t('For example: the mother identified the child in person at the station, and the school ID card was checked.')}
                disabled={busy}
              />
              <span className={`mt-1 block text-[11px] ${v.note.trim().length >= 10 ? 'text-emerald-700' : 'text-gray-400'}`}>
                {t('At least 10 characters.')}
              </span>
            </label>
          </div>
          {!valid && <p className="text-xs text-gray-500">{t('Fill in every field to confirm.')}</p>}
          <ActionMessage action={action} id="confirm" />
        </div>

        <div className="safe-bottom sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t bg-white px-4 py-3 sm:-mx-6 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6 sm:pb-6">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost px-4 py-2 text-sm">
            {t('Cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!valid || action.pending} className="btn-primary px-4 py-2 text-sm">
            {busy ? t('Working…') : t('Confirm — the person has been verified')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Who was told, how, when and by whom — newest first. */
export function FamilyContactList({ report }) {
  const t = useT();
  const contacts = asList(report?.familyContacts).filter((c) => c && typeof c === 'object');
  if (!contacts.length) return null;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('Family contacts recorded')}</p>
      {contacts.slice().reverse().map((c, i) => {
        const when = c.at || c.contactedAt || c.recordedAt || c.ts || c.createdAt;
        const whenText = when && Number.isFinite(new Date(when).getTime()) ? new Date(when).toLocaleString(currentLocale()) : '';
        const how = CONTACT_METHOD_LABELS[c.method] ? t(CONTACT_METHOD_LABELS[c.method]) : txt(c.method);
        const who = txt(c.actorName) || txt(c.recordedByName) || txt(c.byName) || txt(c.officerName);
        return (
          <div key={txt(c.id) || i} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <p className="font-medium text-gray-700">{[how, who].filter(Boolean).join(' · ')}</p>
            {whenText && <p className="text-gray-400">{whenText}</p>}
            {txt(c.note) && <p className="mt-1 whitespace-pre-wrap text-gray-700">{txt(c.note)}</p>}
            {c.personConsent === true && <p className="mt-1 text-emerald-700">{t('With the person’s consent')}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * After a case is marked found: the family phone as a tel: link, and a record
 * that the family was informed. For a woman or adult the call link and the
 * record wait for the officer to record the person's consent, because the
 * family learning where she is can be the danger.
 *
 * `phoneHint` is the family phone the confirm-match answer carried, for a
 * case whose own record does not show one. `onReport` receives the updated
 * case from the server.
 */
export function FamilyContactPanel({ report, phoneHint = '', action, onReport }) {
  const t = useT();
  const adult = isAdultCase(report);
  const [form, setForm] = useState({ method: 'call', note: '' });
  const [consent, setConsent] = useState(false);
  // The last answer from POST /send-sms, shown until the next case.
  const [sms, setSms] = useState(null);

  // Consent is recorded for one person, never carried over to the next case.
  useEffect(() => {
    setConsent(false);
    setSms(null);
    setForm({ method: 'call', note: '' });
  }, [report.id]);

  const phone = txt(report.parentPhone) || txt(phoneHint);
  const allowed = !adult || consent;
  const informedAt = report.familyInformedAt && Number.isFinite(new Date(report.familyInformedAt).getTime())
    ? new Date(report.familyInformedAt).toLocaleString(currentLocale())
    : '';

  const record = () => action.run(
    'family-contacted',
    async () => {
      const data = await api.post(`/reports/${report.id}/family-contacted`, {
        method: form.method,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(adult ? { personConsent: true } : {}),
      });
      if (data?.report) onReport(data.report);
      setForm({ method: 'call', note: '' });
    },
    msg('Recorded that the family was informed.')
  );

  // An SMS is attempted only when the officer asks, and its answer is shown
  // as given: sent:false means nothing went out, whatever else it says.
  const trySms = () => action.run('send-sms', async () => {
    const data = await api.post(`/reports/${report.id}/send-sms`, adult ? { personConsent: true } : {});
    setSms(data && typeof data === 'object' ? data : {});
    if (data?.report) onReport(data.report);
  });

  const smsPhone = txt(sms?.phone) || phone;

  return (
    <div className={`mt-6 rounded-xl p-4 ${adult ? 'bg-amber-50 text-amber-900' : 'bg-khozo-light'}`}>
      <p className="text-sm font-semibold">{adult ? t('Next step: verify with the person') : t('Tell the family')}</p>
      <p className="mt-1 text-xs">
        {adult
          ? t('Verify with the person first; share their location with the family only with their consent.')
          : t('No message goes to the family automatically. Call them, then record that they were informed.')}
      </p>
      {informedAt && (
        <p className="mt-2 text-xs font-semibold text-emerald-800">{t('Family informed {date}', { date: informedAt })}</p>
      )}

      {adult && (
        <label className="mt-3 flex gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t('I have spoken to the person and they agree that their family may be told.')}</span>
        </label>
      )}

      {allowed && (
        phone ? (
          <a href={telHref(phone)} className="btn-primary mt-3 flex w-full items-center justify-center gap-2">
            <span aria-hidden="true">📞</span> {t('Call the family')} · {phone}
          </a>
        ) : (
          <p className="mt-3 text-xs text-gray-600">{t('No family phone number is recorded on this case.')}</p>
        )
      )}

      {allowed && (
        <div className="mt-4 space-y-2 rounded-lg bg-white/70 p-3">
          <label className="block">
            <span className="label">{t('How the family was informed')}</span>
            <select
              className="field w-full"
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
            >
              {FAMILY_METHODS.map((m) => <option key={m.id} value={m.id}>{t(m.label)}</option>)}
            </select>
          </label>
          <textarea
            className="field min-h-16 w-full"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder={t('Note (optional): who you spoke to, what was agreed')}
          />
          <button type="button" className="btn-primary w-full" disabled={action.pending} onClick={record}>
            {t('Record that the family was informed')}
          </button>
          <ActionMessage action={action} id="family-contacted" />
          <button
            type="button"
            className="w-full text-center text-xs font-semibold text-gray-500 underline hover:text-ink"
            disabled={action.pending}
            onClick={trySms}
          >
            {t('Try sending an SMS')}
          </button>
          <ActionMessage action={action} id="send-sms" />
          {sms && (
            sms.sent === true ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {t('The SMS gateway accepted the message. Delivery is not confirmed: call the family as well.')}
              </p>
            ) : (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                <p className="font-semibold">
                  {sms.reason === 'no_gateway'
                    ? t('No SMS was sent: no SMS gateway is connected. Call the family instead.')
                    : t('No SMS was sent. Call the family instead.')}
                </p>
                {sms.sent === false && txt(sms.message) && (
                  <p className="mt-1 whitespace-pre-wrap text-amber-800">{t(txt(sms.message))}</p>
                )}
                {smsPhone && (
                  <a href={telHref(smsPhone)} className="mt-1 inline-flex min-h-11 items-center font-semibold text-khozo hover:underline">
                    {t('Call the family')} · {smsPhone}
                  </a>
                )}
              </div>
            )
          )}
        </div>
      )}

      <FamilyContactList report={report} />
    </div>
  );
}

/**
 * Takes a found or closed case back to missing: the person was wrongly
 * identified, or has gone missing again. The reason is required.
 */
export function ReopenCasePanel({ report, action, onReport }) {
  const t = useT();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [report.id]);

  const reopen = () => action.run(
    'reopen',
    async () => {
      const data = await api.post(`/reports/${report.id}/reopen`, { reason: reason.trim() });
      if (data?.report) onReport(data.report);
      setReason('');
    },
    msg('Case reopened. It is back on the missing list.')
  );

  return (
    <div className="mt-6 rounded-xl border border-black/5 p-4">
      <p className="text-sm font-medium">{t('Reopen case')}</p>
      <p className="text-xs text-gray-600">
        {t('If the person was wrongly identified, or is missing again, reopen the case. The reason is recorded with it.')}
      </p>
      <textarea
        className="field mt-3 min-h-16 w-full"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('Why the case is being reopened (at least 10 characters)')}
      />
      <button type="button" className="btn-ghost mt-2 w-full" disabled={action.pending || reason.trim().length < 10} onClick={reopen}>
        {t('Reopen case')}
      </button>
      <ActionMessage action={action} id="reopen" />
    </div>
  );
}
