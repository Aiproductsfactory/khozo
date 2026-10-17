import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useT, msg } from '../i18n.jsx';
import { genderLabel, isAdultCategory, PERSON_CATEGORY_OPTIONS, PhoneLink } from '../lib.jsx';
import { preparePhoto } from '../photoPrep.js';
import { DASHBOARD_ROUTE_ROLES } from './routes.js';

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
const DECLARATION_METHODS = [
  { id: 'digital', label: msg('Digital self-declaration') },
  { id: 'verbal_recorded', label: msg('Verbal declaration recorded by officer') },
  { id: 'paper_signed', label: msg('Paper declaration signed') },
];

function initialForm(user, isPolice) {
  return {
    personCategory: 'child',
    childName: '', parentName: '', parentPhone: '', parentEmail: '',
    childAadhar: '', gender: 'Male', age: '', height: '', weight: '',
    dateOfMissing: '', address: '', state: '', district: '', zip: '', firNo: '',
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
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
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
   * officer can no longer see is never submitted: the child-only fields, and
   * an age outside the new range. A woman defaults to Female.
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
        gender: next === 'woman' && f.gender === 'Male' ? 'Female' : next === 'child' && f.gender === 'Other' ? 'Male' : f.gender,
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
  // several MB, and a station's mobile data is not always fast.
  const onFile = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setPreview(URL.createObjectURL(picked));
    setFile(picked);
    const ready = await preparePhoto(picked);
    setFile(ready);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
        else if (v != null && v !== '') fd.append(k, v);
      });
      if (allowDuplicate) fd.append('allowDuplicate', 'true');
      if (file) fd.append('photo', file);
      // The server also compares the new photo with earlier sightings that are
      // not linked to any case, inside this request, and says how many it sent
      // for review.
      const data = await api.postForm('/reports', fd);
      setCreated({ id: data.report?.id || null, sightingMatches: Number(data.sightingMatches) || 0 });
      try { window.scrollTo({ top: 0 }); } catch {}
    } catch (e) {
      if (e.data?.duplicateCandidates?.length) {
        setDuplicates(e.data.duplicateCandidates);
        setAllowDuplicate(false);
      }
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const registerAnother = () => {
    setForm(initialForm(user, isPolice));
    setFile(null);
    setPreview(null);
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
          <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-gray-300 text-3xl text-gray-300">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : adult ? '👤' : '🧒'}
          </div>
          <div className="min-w-0 flex-1">
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" className="btn-ghost" onClick={() => cameraRef.current?.click()}>
                <span aria-hidden="true">📷</span> {t('Take a photo')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                <span aria-hidden="true">🖼️</span> {adult ? t('Upload photo') : t('Upload child image')}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-400">{t('A clear, front-facing face photo works best.')}</p>
          </div>
        </div>
        <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={form.photoConsent} onChange={setChecked('photoConsent')} required={!!file} />
          <span>
            {adult
              ? t('I confirm this photo may be used for the missing-person investigation, police review, and face-match search. Photo metadata will be retained for the case lifecycle.')
              : t('I confirm this photo may be used for missing-child investigation, police/CWC review, and face-match search. Photo metadata will be retained for the case lifecycle.')}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field form={form} set={set} label={adult ? t('Full name') : t('Child name')} k="childName" req autoComplete="off" />
          <Field form={form} set={set} label={adult ? t('Aadhaar no.') : t('Child Aadhar no.')} k="childAadhar" inputMode="numeric" autoComplete="off" />
          <div>
            <label className="label">{t('Gender')}</label>
            <select className="field" value={form.gender} onChange={set('gender')}>
              {category === 'child' && (
                <>
                  <option value="Male">{t('Male')}</option><option value="Female">{t('Female')}</option>
                </>
              )}
              {category === 'woman' && (
                <>
                  <option value="Female">{genderLabel('Female', category)}</option><option value="Other">{t('Other')}</option>
                </>
              )}
              {category === 'adult' && (
                <>
                  <option value="Male">{genderLabel('Male', category)}</option>
                  <option value="Female">{genderLabel('Female', category)}</option>
                  <option value="Other">{t('Other')}</option>
                </>
              )}
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
            <Field form={form} set={set} label={t('State')} k="state" autoComplete={own('address-level1')} />
            <Field form={form} set={set} label={t('District')} k="district" autoComplete={own('address-level2')} />
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
          <button className="btn-primary flex-1 sm:flex-none" disabled={busy}>{busy ? t('Submitting...') : allowDuplicate ? t('Submit duplicate anyway') : t('Submit')}</button>
        </div>
      </form>
    </div>
  );
}
