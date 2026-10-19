import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useT, msg } from '../i18n.jsx';
import { genderLabel, isAdultCategory, PERSON_CATEGORY_OPTIONS, PhoneLink } from '../lib.jsx';
import { preparePhoto } from '../photoPrep.js';
import { MAX_CASE_PHOTOS } from '../../../shared/photo-set.js';
import DistrictPicker from '../DistrictPicker.jsx';
import { DASHBOARD_ROUTE_ROLES } from './routes.js';
import NavIcon from './NavIcon.jsx';

// What each "Who is missing?" choice is called in the page title.
const REGISTER_TITLES = {
  child: msg('Register a missing child'),
  woman: msg('Register a missing woman'),
  adult: msg('Register a missing person'),
};
// The age the form accepts, matching the server (shared/case-domain.js).
const AGE_LIMITS = {
  child: { min: 0, max: 18 },
  woman: { min: 18, max: 110 },
  adult: { min: 18, max: 110 },
};
// Fields that only mean something for a child: school level, the JJ Act
// "produced by" record, and child-labour risk.
const CHILD_ONLY_VULNERABILITIES = ['child_labour_risk'];

const VULNERABILITY_CATEGORIES = [
  { id: 'unaccompanied', label: msg('Unaccompanied / lost') },
  { id: 'trafficking_risk', label: msg('Trafficking risk') },
  { id: 'child_labour_risk', label: msg('Child labour risk') },
  { id: 'medical_attention', label: msg('Medical attention') },
  { id: 'mental_health_support', label: msg('Mental-health support') },
  { id: 'disability_support', label: msg('Disability support') },
  { id: 'language_barrier', label: msg('Language barrier') },
  { id: 'shelter_required', label: msg('Shelter required') },
  { id: 'abuse_risk', label: msg('Abuse / exploitation risk') },
];
const PRODUCED_BY_TYPES = [
  { id: '', label: msg('Not recorded') },
  { id: 'police', label: msg('Police / SJPU') },
  { id: 'cwc', label: msg('CWC') },
  { id: 'dcpu', label: msg('DCPU') },
  { id: 'rpf', label: msg('RPF') },
  { id: 'ngo', label: msg('NGO') },
  { id: 'citizen', label: msg('Citizen / parent') },
  { id: 'self', label: msg('Child self-reported') },
  { id: 'other', label: msg('Other authority') },
];
const EDUCATION_LEVELS = [
  { id: 'unknown', label: msg('Unknown') },
  { id: 'not_enrolled', label: msg('Not enrolled') },
  { id: 'primary', label: msg('Primary') },
  { id: 'upper_primary', label: msg('Upper primary') },
  { id: 'secondary', label: msg('Secondary') },
  { id: 'senior_secondary', label: msg('Senior secondary') },
];
const YES_NO_UNKNOWN = [
  { id: 'unknown', label: msg('Unknown') },
  { id: 'yes', label: msg('Yes') },
  { id: 'no', label: msg('No') },
];

/**
 * One labelled text input.
 *
 * Module scope, deliberately. This was declared inside `RegisterChild`, so
 * every keystroke produced a new component *type*: React unmounted the old
 * input and mounted a new one, the browser had nothing to keep focus on, and
 * the caret jumped out of the field after a single character. Registering a
 * child's name was effectively impossible.
 */
function Field({ label, k, type = 'text', req, form, set, ...rest }) {
  return (
    <div>
      <label className="label">{label}{req && ' *'}</label>
      <input className="field" type={type} value={form[k]} onChange={set(k)} required={req} {...rest} />
    </div>
  );
}
// The genders offered for each "Who is missing?" choice. Unknown is always an
// answer the form accepts; Male is never the default.
const GENDER_CHOICES = {
  child: ['Male', 'Female', 'Unknown'],
  woman: ['Female', 'Other'],
  adult: ['Male', 'Female', 'Other', 'Unknown'],
};

const DECLARATION_METHODS = [
  { id: 'digital', label: msg('Digital self-declaration') },
  { id: 'verbal_recorded', label: msg('Verbal declaration recorded by officer') },
  { id: 'paper_signed', label: msg('Paper declaration signed') },
];

function initialForm(user, isPolice) {
  // The registering account's own area is offered first: an officer mostly
  // registers for their own district, a family for where they live. Either
  // can change it.
  const own = user.jurisdiction || {};
  return {
    personCategory: 'child',
    childName: '', parentName: '', parentPhone: '', parentEmail: '',
    // No gender is assumed: the form used to start on Male, so a child whose
    // gender nobody entered was registered as a boy. It must be chosen
    // (Unknown is a choice).
    childAadhar: '', gender: '', age: '', height: '', weight: '',
    dateOfMissing: '', address: '', zip: '', firNo: '',
    state: own.state || '', stateCode: own.stateCode || '',
    district: own.district || '', districtCode: own.districtCode || '',
    complexion: '', build: '', hair: '', clothing: '', languages: '',
    birthMark: '', identificationMark: '', producedByType: '', educationLevel: 'unknown',
    disabilityStatus: 'unknown', mentalHealthConcern: 'unknown', circumstances: '',
    vulnerabilityCategories: [],
    declarationAccepted: false,
    declarationMethod: 'digital',
    declarationSignerName: user.name || '',
    declarationSignerRole: isPolice ? user.role : 'parent',
    relationshipToChild: isPolice ? 'official' : 'parent',
    photoConsent: false,
  };
}

// The deck's registration / FIR form. Police see the FIR field; parents/NGOs file a report.
export default function RegisterChild() {
  const t = useT();
  const { user } = useAuth();
  const nav = useNavigate();
  const isPolice = ['police', 'sjpu', 'admin', 'super_admin'].includes(user.role);
  // Only those who work the Matches queue are told about possible matches: a
  // family hears about a match after an officer has confirmed it, not before.
  const canReviewMatches = (DASHBOARD_ROUTE_ROLES.matches || []).includes(user.role);
  const [form, setForm] = useState(() => initialForm(user, isPolice));
  // { id, sightingMatches } once the case is saved.
  const [created, setCreated] = useState(null);
  // The photos of the person, the main one first (shared/photo-set.js):
  // [{ key, file, preview }]. A family often has more than one, and a second
  // photo - another age, another angle - is often the one that matches.
  const [photos, setPhotos] = useState([]);
  const file = photos[0]?.file || null;
  // A photo is made smaller on the phone before it is sent; until every one
  // is ready, sending would carry the full-size camera files.
  const preparingPhotos = photos.some((p) => p.preparing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // An officer registers someone else's details: the browser must not offer
  // the officer's own phone or address. A parent filing for their own child
  // gets their saved details offered.
  const own = (value) => (isPolice ? 'off' : value);
  const setChecked = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const category = form.personCategory;
  const adult = isAdultCategory(category);
  const ageLimits = AGE_LIMITS[category] || AGE_LIMITS.child;

  /**
   * Switching who is missing clears what no longer applies, so a value the
   * officer can no longer see is never submitted: the child-only fields, an
   * age outside the new range, and a gender the new choice does not offer. A
   * woman is Female; nobody else's gender is filled in.
   */
  const chooseCategory = (next) => {
    setForm((f) => {
      const nextAdult = isAdultCategory(next);
      const limits = AGE_LIMITS[next] || AGE_LIMITS.child;
      const age = f.age === '' || (Number(f.age) >= limits.min && Number(f.age) <= limits.max) ? f.age : '';
      return {
        ...f,
        personCategory: next,
        age,
        gender: next === 'woman'
          ? (['Female', 'Other'].includes(f.gender) ? f.gender : 'Female')
          : (GENDER_CHOICES[next] || GENDER_CHOICES.child).includes(f.gender) ? f.gender : '',
        ...(nextAdult
          ? {
              producedByType: '',
              educationLevel: 'unknown',
              vulnerabilityCategories: f.vulnerabilityCategories.filter((id) => !CHILD_ONLY_VULNERABILITIES.includes(id)),
            }
          : {}),
      };
    });
  };
  const toggleCategory = (id) => {
    setForm((f) => ({
      ...f,
      vulnerabilityCategories: f.vulnerabilityCategories.includes(id)
        ? f.vulnerabilityCategories.filter((item) => item !== id)
        : [...f.vulnerabilityCategories, id],
    }));
  };

  // Shrunk on the phone before upload (photoPrep.js): a camera photo is
  // several MB, and a station's mobile data is not always fast. Each photo is
  // replaced by its prepared copy under its own key, so a slow one never
  // overwrites another.
  const onFile = (e) => {
    const picked = [...(e.target.files || [])].slice(0, Math.max(0, MAX_CASE_PHOTOS - photos.length));
    e.target.value = '';
    if (!picked.length) return;
    const added = picked.map((raw) => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: raw, preview: URL.createObjectURL(raw), preparing: true }));
    setPhotos((prev) => [...prev, ...added].slice(0, MAX_CASE_PHOTOS));
    for (const photo of added) {
      preparePhoto(photo.file).then((ready) => {
        setPhotos((prev) => prev.map((p) => (p.key === photo.key ? { ...p, file: ready, preparing: false } : p)));
      });
    }
  };
  const removePhoto = (key) => setPhotos((prev) => {
    const gone = prev.find((p) => p.key === key);
    if (gone) URL.revokeObjectURL(gone.preview);
    return prev.filter((p) => p.key !== key);
  });
  // The main photo is shown on the case and compared first with every sighting.
  const makeMain = (key) => setPhotos((prev) => [...prev.filter((p) => p.key === key), ...prev.filter((p) => p.key !== key)]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    // An officer files a case in a real district, chosen from the list: a
    // case under a district that does not exist is one no desk sees.
    if (isPolice && (!form.stateCode || !form.districtCode)) {
      setErr(t('Choose the state and the district from the lists.'));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
        else if (v != null && v !== '') fd.append(k, v);
      });
      if (allowDuplicate) fd.append('allowDuplicate', 'true');
      // The main photo as `photo`, the others beside it (shared/photo-set.js).
      photos.forEach((p, i) => fd.append(i === 0 ? 'photo' : 'extraPhotos', p.file));
      // The server also compares the new photo with earlier sightings that are
      // not linked to any case, inside this request, and says how many it sent
      // for review.
      const data = await api.postForm('/reports', fd);
      setCreated({
        id: data.report?.id || null,
        sightingMatches: Number(data.sightingMatches) || 0,
        pendingVerification: data.report?.status === 'intake_pending',
        // Whether the photo will find the person in a sighting. The face check
        // runs only on a case matched at once (an officer's); a family's
        // report is checked when an officer verifies it.
        hadPhoto: Boolean(file),
        // A usable other photo is what matching leads with (shared/photo-set.js).
        photoVerdict: (data.report?.extraPhotos || []).some((p) => p?.check?.verdict === 'usable')
          ? 'usable'
          : data.report?.photoCheck?.verdict || null,
        place: [data.report?.district || data.report?.districtText, data.report?.state].filter(Boolean).join(', '),
      });
      try { window.scrollTo({ top: 0 }); } catch {}
    } catch (e) {
      if (e.data?.duplicateCandidates?.length) {
        setDuplicates(e.data.duplicateCandidates);
        setAllowDuplicate(false);
      }
      // A place the gazetteer does not know (shared/case-domain.js
      // jurisdictionError): said in the reader's language.
      if (e.data?.code === 'unknown_district') setErr(t('That district is not in the list for this state. Choose the district from the list.'));
      else if (e.data?.code === 'unknown_state') setErr(t('Choose the state and the district from the lists.'));
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const registerAnother = () => {
    setForm(initialForm(user, isPolice));
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setDuplicates([]);
    setAllowDuplicate(false);
    setErr('');
    setCreated(null);
  };

  if (created) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Case registered')}</p>
          {created.id && (
            <>
              <h2 className="mt-1 text-2xl font-bold">{t('Case ID: {id}', { id: created.id })}</h2>
              <p className="mt-2 text-sm text-gray-600">
                {t('Keep this Case ID safe: it is the only reference the family can use on the public Track my case page.')}
              </p>
            </>
          )}
          {/*
            A family's or an NGO's report waits for an officer, and nothing is
            compared with it until one verifies it. The family is told so, in
            plain words, with the one thing they can do to speed it up.
          */}
          {created.pendingVerification && (
            <div className="mt-5 rounded-xl bg-sky-50 px-4 py-4 text-sm text-sky-900">
              <p className="font-semibold">{t('What happens next')}</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>
                  {created.place
                    ? t('Take this Case ID and an ID proof (Aadhaar, voter ID or any photo ID) to the nearest police station in {place}.', { place: created.place })
                    : t('Take this Case ID and an ID proof (Aadhaar, voter ID or any photo ID) to the nearest police station.')}
                </li>
                <li>{t('Matching with sightings starts once an officer verifies your report. The police and child-welfare desks of the district have been told it is waiting.')}</li>
                <li className="font-semibold">{t('In an emergency, call 112.')}</li>
              </ol>
            </div>
          )}
          {/*
            The moment to ask for a better photo is now, while the family is
            still at the desk or the form: later it means finding them again.
          */}
          {(!created.hadPhoto || ['no_face', 'multiple_faces'].includes(created.photoVerdict)) && (
            <div role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
              <p className="font-semibold">
                {!created.hadPhoto
                  ? t('No photo was added, so no sighting can be matched with this case by face.')
                  : created.photoVerdict === 'no_face'
                    ? t('No face was found in this photo, so it cannot be matched with a sighting.')
                    : t('This is a group photo: the match cannot tell which face is the missing person.')}
              </p>
              <p className="mt-1">
                {isPolice
                  ? t('Ask the family for a recent, clear photo of the face alone, and add it from the case.')
                  : t('If you have a recent, clear photo of the face alone, take it to the police station with this Case ID.')}
              </p>
              {isPolice && created.id && (
                <Link to={`/app/cases?id=${encodeURIComponent(created.id)}`} className="mt-2 inline-block font-semibold text-khozo-dark hover:underline">
                  {t('Open the case')}
                </Link>
              )}
            </div>
          )}
          {canReviewMatches && created.sightingMatches > 0 && (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {t('Checked against earlier sightings: {n} possible match(es) sent for review', { n: created.sightingMatches })}{' '}
              <Link to="/app/matches" className="font-semibold text-khozo hover:underline">{t('Open the Matches queue')}</Link>
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/app/cases" className="btn-primary">{t('Open cases')}</Link>
            <button type="button" className="btn-ghost" onClick={registerAnother}>{t('Register another case')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        {isPolice && <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Register FIR')}</p>}
        <h2 className="text-2xl font-bold">{t(REGISTER_TITLES[category] || REGISTER_TITLES.child)}</h2>
        <p className="text-sm text-gray-500">{t('Provide as much detail as possible — it improves match accuracy.')}</p>
      </div>

      {/*
        Who is missing decides the age range, which child-protection fields
        apply, and how the case is handled once the person is traced.
      */}
      <div className="card p-4">
        <p className="label mb-2">{t('Who is missing?')}</p>
        <div role="radiogroup" aria-label={t('Who is missing?')} className="grid grid-cols-3 gap-2">
          {PERSON_CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={category === option.id}
              onClick={() => chooseCategory(option.id)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                category === option.id
                  ? 'border-khozo bg-khozo-light text-khozo-dark ring-1 ring-khozo/40'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
        {adult && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>
              {t('An adult has the right not to be found. When the person is traced, verify with them first and share their location with the family only with their consent.')}
            </p>
            {category === 'woman' && (
              <p className="mt-1">
                {t('If she may be in danger, call 112. The Women Helpline 181 and the One Stop Centre (Sakhi) can also help.')}
              </p>
            )}
          </div>
        )}
      </div>

      {err && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {duplicates.length > 0 && (
        <div className="card border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900">{t('Possible duplicate case found')}</h3>
          <p className="mt-1 text-sm text-amber-800">{t('Review these records before creating another case.')}</p>
          <div className="mt-3 space-y-2">
            {duplicates.map((d) => (
              <div key={d.reportId} className="rounded-lg bg-white/80 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold capitalize">{d.childName}</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{t('{pct}% similar', { pct: Math.round(d.score * 100) })}</span>
                </div>
                <p className="mt-1 text-gray-600">
                  {genderLabel(d.gender, d.personCategory)} · {t('age {age}', { age: d.age ?? '-' })} · {d.status} · {[d.district, d.state].filter(Boolean).join(', ') || t('location unknown')}
                </p>
                <p className="text-xs text-gray-400">{d.parentName || t('Guardian unknown')} {d.parentPhone ? <>· <PhoneLink phone={d.parentPhone} /></> : ''}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => { setAllowDuplicate(true); setDuplicates([]); setErr(''); }}>
              {t('Submit anyway')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setDuplicates([]); setErr(''); }}>
              {t('Edit details')}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="card space-y-6 p-4 sm:p-6">
        {/*
          Photo. On a phone the camera opens straight away; a photo already on
          the phone (a family picture shared on WhatsApp) comes from the gallery.
        */}
        <div className="flex items-start gap-4">
          {photos.length === 0 && (
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-gray-300 text-3xl text-gray-300">
              {adult ? '👤' : '🧒'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {photos.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-3 pt-2" aria-label={t('Photos of the person')}>
                {photos.map((p, i) => (
                  <li key={p.key} className="relative">
                    <img src={p.preview} alt="" className="h-24 w-24 rounded-xl object-cover ring-1 ring-black/10" />
                    {i === 0 ? (
                      <span className="absolute left-1 top-1 rounded bg-khozo px-1.5 py-0.5 text-[10px] font-bold text-white">{t('Main')}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => makeMain(p.key)}
                        className="absolute inset-x-1 bottom-1 rounded bg-black/60 px-1 py-1 text-[11px] font-semibold text-white hover:bg-black/75"
                      >
                        {t('Make main')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(p.key)}
                      aria-label={t('Remove')}
                      className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-gray-900 text-white ring-2 ring-white hover:bg-black"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFile} className="hidden" />
            {photos.length < MAX_CASE_PHOTOS && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" className="btn-ghost" onClick={() => cameraRef.current?.click()}>
                  <NavIcon name="sightings" className="h-4 w-4 shrink-0" /> {t('Take a photo')}
                </button>
                <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                  <NavIcon name="upload" className="h-4 w-4 shrink-0" />{' '}
                  {photos.length ? t('Add another photo') : adult ? t('Upload photo') : t('Upload child image')}
                </button>
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">
              {t('A clear, front-facing face photo works best. Up to {n} photos: different ages and angles help.', { n: MAX_CASE_PHOTOS })}
            </p>
          </div>
        </div>
        <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={form.photoConsent} onChange={setChecked('photoConsent')} required={!!file} />
          <span>
            {photos.length > 1
              ? adult
                ? t('I confirm these photos may be used for the missing-person investigation, police review, and face-match search. The photos are kept for 10 years from registration, or longer while the case is open.')
                : t('I confirm these photos may be used for missing-child investigation, police/CWC review, and face-match search. The photos are kept for 10 years from registration, or longer while the case is open.')
              : adult
                ? t('I confirm this photo may be used for the missing-person investigation, police review, and face-match search. The photo is kept for 10 years from registration, or longer while the case is open.')
                : t('I confirm this photo may be used for missing-child investigation, police/CWC review, and face-match search. The photo is kept for 10 years from registration, or longer while the case is open.')}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field form={form} set={set} label={adult ? t('Full name') : t('Child name')} k="childName" req autoComplete="off" />
          <Field form={form} set={set} label={adult ? t('Aadhaar no.') : t('Child Aadhar no.')} k="childAadhar" inputMode="numeric" autoComplete="off" />
          <div>
            <label className="label" htmlFor="register-gender">{t('Gender')} *</label>
            <select id="register-gender" className="field" value={form.gender} onChange={set('gender')} required>
              <option value="" disabled>{t('Choose…')}</option>
              {(GENDER_CHOICES[category] || GENDER_CHOICES.child).map((g) => (
                <option key={g} value={g}>{g === 'Unknown' ? t('Not known') : genderLabel(g, category)}</option>
              ))}
            </select>
          </div>
          <Field form={form} set={set} label={t('Date of missing')} k="dateOfMissing" type="date" />
          <Field form={form} set={set} label={t('Age')} k="age" type="number" inputMode="numeric" min={ageLimits.min} max={ageLimits.max} />
          <Field form={form} set={set} label={t('Height (cm)')} k="height" type="number" inputMode="numeric" />
          <Field form={form} set={set} label={t('Weight (kg)')} k="weight" type="number" inputMode="decimal" />
          {isPolice && <Field form={form} set={set} label={t('FIR no.')} k="firNo" placeholder={t('auto-generated if blank')} />}
        </div>

        <div className="border-t border-black/5 pt-5">
          <h3 className="mb-3 font-semibold">{adult ? t('Family contact & address') : t('Guardian / parent & address')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field form={form} set={set} label={adult ? t('Family contact name') : t('Guardian / parent name')} k="parentName" autoComplete={own('name')} />
            <Field form={form} set={set} label={t('Mobile no.')} k="parentPhone" type="tel" inputMode="tel" autoComplete={own('tel')} />
            <Field form={form} set={set} label={t('Email')} k="parentEmail" type="email" inputMode="email" autoComplete={own('email')} autoCapitalize="off" />
            <Field form={form} set={set} label={t('Address')} k="address" autoComplete={own('street-address')} />
            {/*
              Where the case belongs decides which desks see it and are told
              about it, so it is chosen from the lists. An officer must name
              the district; a family may say "Not sure".
            */}
            <div className="sm:col-span-2">
              <DistrictPicker
                value={form}
                onChange={(place) => setForm((f) => ({ ...f, ...place }))}
                required={isPolice}
                allowUnsure={!isPolice}
                stateLabel={adult ? t('State where the person went missing') : t('State where the child went missing')}
                districtLabel={adult ? t('District where the person went missing') : t('District where the child went missing')}
              />
            </div>
            <Field form={form} set={set} label={t('Zip code')} k="zip" inputMode="numeric" autoComplete={own('postal-code')} />
          </div>
        </div>

        <div className="border-t border-black/5 pt-5">
          <h3 className="mb-3 font-semibold">{t('Identification & vulnerability profile')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field form={form} set={set} label={t('Complexion')} k="complexion" />
            <Field form={form} set={set} label={t('Build')} k="build" />
            <Field form={form} set={set} label={t('Hair')} k="hair" />
            <Field form={form} set={set} label={t('Clothing when last seen')} k="clothing" />
            <Field form={form} set={set} label={t('Languages / dialect')} k="languages" />
            <Field form={form} set={set} label={t('Birth mark')} k="birthMark" />
            <Field form={form} set={set} label={t('Identification mark')} k="identificationMark" />
            {!adult && (
              <div>
                <label className="label">{t('Produced by / source')}</label>
                <select className="field" value={form.producedByType} onChange={set('producedByType')}>
                  {PRODUCED_BY_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.label)}</option>)}
                </select>
              </div>
            )}
            {!adult && (
              <div>
                <label className="label">{t('Education')}</label>
                <select className="field" value={form.educationLevel} onChange={set('educationLevel')}>
                  {EDUCATION_LEVELS.map((level) => <option key={level.id} value={level.id}>{t(level.label)}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">{t('Disability support')}</label>
              <select className="field" value={form.disabilityStatus} onChange={set('disabilityStatus')}>
                {YES_NO_UNKNOWN.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('Mental-health concern')}</label>
              <select className="field" value={form.mentalHealthConcern} onChange={set('mentalHealthConcern')}>
                {YES_NO_UNKNOWN.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="label">{t('Vulnerability categories')}</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {VULNERABILITY_CATEGORIES
                .filter((item) => !adult || !CHILD_ONLY_VULNERABILITIES.includes(item.id))
                .map((item) => (
                  <label key={item.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.vulnerabilityCategories.includes(item.id)}
                      onChange={() => toggleCategory(item.id)}
                    />
                    <span>{t(item.label)}</span>
                  </label>
                ))}
            </div>
          </div>
          <div className="mt-4">
            <label className="label">{adult ? t('Circumstances of disappearance') : t('Circumstances / Form-J notes')}</label>
            <textarea className="field min-h-20 w-full" value={form.circumstances} onChange={set('circumstances')} />
          </div>
        </div>

        <div className="border-t border-black/5 pt-5">
          <h3 className="mb-3 font-semibold">{t('Reporter declaration')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field form={form} set={set} label={t('Signer name')} k="declarationSignerName" req autoComplete={own('name')} />
            <Field form={form} set={set} label={adult ? t('Relationship to the missing person') : t('Relationship to child')} k="relationshipToChild" req />
            <Field form={form} set={set} label={t('Signer role / designation')} k="declarationSignerRole" />
            <div>
              <label className="label">{t('Declaration method')}</label>
              <select className="field" value={form.declarationMethod} onChange={set('declarationMethod')}>
                {DECLARATION_METHODS.map((method) => <option key={method.id} value={method.id}>{t(method.label)}</option>)}
              </select>
            </div>
          </div>
          <label className="mt-4 flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={form.declarationAccepted} onChange={setChecked('declarationAccepted')} required />
            <span>
              {adult
                ? t('I declare that the information provided is true to the best of my knowledge and may be used by authorized police and support services for tracing and verification.')
                : t('I declare that the information provided is true to the best of my knowledge and may be used by authorized police, SJPU, CWC/DCPU, and child-protection authorities for tracing, verification, and restoration.')}
            </span>
          </label>
        </div>

        {/*
          A long form: on a phone the buttons stay pinned above the bottom
          navigation, so submitting never means scrolling back down to find them.
        */}
        <div className="sticky bottom-[calc(3.5625rem+env(safe-area-inset-bottom,0px))] z-10 -mx-4 flex justify-end gap-3 border-t border-black/5 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <button type="button" className="btn-ghost" onClick={() => nav('/app')}>{t('Cancel')}</button>
          <button className="btn-primary flex-1 sm:flex-none" disabled={busy || preparingPhotos}>
            {busy ? t('Submitting...') : preparingPhotos ? t('Preparing the photos…') : allowDuplicate ? t('Submit duplicate anyway') : t('Submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
