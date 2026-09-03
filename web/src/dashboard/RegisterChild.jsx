import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const VULNERABILITY_CATEGORIES = [
  { id: 'unaccompanied', label: 'Unaccompanied / lost' },
  { id: 'trafficking_risk', label: 'Trafficking risk' },
  { id: 'child_labour_risk', label: 'Child labour risk' },
  { id: 'medical_attention', label: 'Medical attention' },
  { id: 'mental_health_support', label: 'Mental-health support' },
  { id: 'disability_support', label: 'Disability support' },
  { id: 'language_barrier', label: 'Language barrier' },
  { id: 'shelter_required', label: 'Shelter required' },
  { id: 'abuse_risk', label: 'Abuse / exploitation risk' },
];
const PRODUCED_BY_TYPES = [
  { id: '', label: 'Not recorded' },
  { id: 'police', label: 'Police / SJPU' },
  { id: 'cwc', label: 'CWC' },
  { id: 'dcpu', label: 'DCPU' },
  { id: 'rpf', label: 'RPF' },
  { id: 'ngo', label: 'NGO' },
  { id: 'citizen', label: 'Citizen / parent' },
  { id: 'self', label: 'Child self-reported' },
  { id: 'other', label: 'Other authority' },
];
const EDUCATION_LEVELS = [
  { id: 'unknown', label: 'Unknown' },
  { id: 'not_enrolled', label: 'Not enrolled' },
  { id: 'primary', label: 'Primary' },
  { id: 'upper_primary', label: 'Upper primary' },
  { id: 'secondary', label: 'Secondary' },
  { id: 'senior_secondary', label: 'Senior secondary' },
];
const YES_NO_UNKNOWN = [
  { id: 'unknown', label: 'Unknown' },
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
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
  { id: 'digital', label: 'Digital self-declaration' },
  { id: 'verbal_recorded', label: 'Verbal declaration recorded by officer' },
  { id: 'paper_signed', label: 'Paper declaration signed' },
];

// The deck's registration / FIR form. Police see the FIR field; parents/NGOs file a report.
export default function RegisterChild() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isPolice = ['police', 'sjpu', 'admin', 'super_admin'].includes(user.role);
  const [form, setForm] = useState({
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
  });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setChecked = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const toggleCategory = (id) => {
    setForm((f) => ({
      ...f,
      vulnerabilityCategories: f.vulnerabilityCategories.includes(id)
        ? f.vulnerabilityCategories.filter((item) => item !== id)
        : [...f.vulnerabilityCategories, id],
    }));
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
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
      await api.postForm('/reports', fd);
      nav('/app/cases');
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold">{isPolice ? 'Register FIR' : 'Register a missing child'}</h2>
        <p className="text-sm text-gray-500">Provide as much detail as possible — it improves match accuracy.</p>
      </div>

      {err && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {duplicates.length > 0 && (
        <div className="card border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900">Possible duplicate case found</h3>
          <p className="mt-1 text-sm text-amber-800">Review these records before creating another case.</p>
          <div className="mt-3 space-y-2">
            {duplicates.map((d) => (
              <div key={d.reportId} className="rounded-lg bg-white/80 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold capitalize">{d.childName}</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{Math.round(d.score * 100)}% similar</span>
                </div>
                <p className="mt-1 text-gray-600">
                  {d.gender} · age {d.age ?? '-'} · {d.status} · {[d.district, d.state].filter(Boolean).join(', ') || 'location unknown'}
                </p>
                <p className="text-xs text-gray-400">{d.parentName || 'Guardian unknown'} {d.parentPhone ? `· ${d.parentPhone}` : ''}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => { setAllowDuplicate(true); setDuplicates([]); setErr(''); }}>
              Submit anyway
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setDuplicates([]); setErr(''); }}>
              Edit details
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="card space-y-6 p-6">
        {/* Photo */}
        <div className="flex items-center gap-4">
          <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-gray-300 text-3xl text-gray-300">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : '🧒'}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>Upload child image *</button>
            <p className="mt-1 text-xs text-gray-400">A clear, front-facing face photo works best.</p>
          </div>
        </div>
        <label className="flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={form.photoConsent} onChange={setChecked('photoConsent')} required={!!file} />
          <span>
            I confirm this photo may be used for missing-child investigation, police/CWC review, and face-match search. Photo metadata will be retained for the case lifecycle.
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field form={form} set={set} label="Child name" k="childName" req />
          <Field form={form} set={set} label="Child Aadhar no." k="childAadhar" />
          <div>
            <label className="label">Gender</label>
            <select className="field" value={form.gender} onChange={set('gender')}>
              <option>Male</option><option>Female</option>
            </select>
          </div>
          <Field form={form} set={set} label="Date of missing" k="dateOfMissing" type="date" />
          <Field form={form} set={set} label="Age" k="age" type="number" />
          <Field form={form} set={set} label="Height (cm)" k="height" type="number" />
          <Field form={form} set={set} label="Weight (kg)" k="weight" type="number" />
          {isPolice && <Field form={form} set={set} label="FIR no." k="firNo" placeholder="auto-generated if blank" />}
        </div>

        <div className="border-t border-black/5 pt-5">
          <h3 className="mb-3 font-semibold">Guardian / parent &amp; address</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field form={form} set={set} label="Guardian / parent name" k="parentName" />
            <Field form={form} set={set} label="Mobile no." k="parentPhone" />
            <Field form={form} set={set} label="Email" k="parentEmail" type="email" />
            <Field form={form} set={set} label="Address" k="address" />
            <Field form={form} set={set} label="State" k="state" />
            <Field form={form} set={set} label="District" k="district" />
            <Field form={form} set={set} label="Zip code" k="zip" />
          </div>
        </div>

        <div className="border-t border-black/5 pt-5">
          <h3 className="mb-3 font-semibold">Identification &amp; vulnerability profile</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field form={form} set={set} label="Complexion" k="complexion" />
            <Field form={form} set={set} label="Build" k="build" />
            <Field form={form} set={set} label="Hair" k="hair" />
            <Field form={form} set={set} label="Clothing when last seen" k="clothing" />
            <Field form={form} set={set} label="Languages / dialect" k="languages" />
            <Field form={form} set={set} label="Birth mark" k="birthMark" />
            <Field form={form} set={set} label="Identification mark" k="identificationMark" />
            <div>
              <label className="label">Produced by / source</label>
              <select className="field" value={form.producedByType} onChange={set('producedByType')}>
                {PRODUCED_BY_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Education</label>
              <select className="field" value={form.educationLevel} onChange={set('educationLevel')}>
                {EDUCATION_LEVELS.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Disability support</label>
              <select className="field" value={form.disabilityStatus} onChange={set('disabilityStatus')}>
                {YES_NO_UNKNOWN.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Mental-health concern</label>
              <select className="field" value={form.mentalHealthConcern} onChange={set('mentalHealthConcern')}>
                {YES_NO_UNKNOWN.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Vulnerability categories</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {VULNERABILITY_CATEGORIES.map((category) => (
                <label key={category.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.vulnerabilityCategories.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />
                  <span>{category.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Circumstances / Form-J notes</label>
            <textarea className="field min-h-20 w-full" value={form.circumstances} onChange={set('circumstances')} />
          </div>
        </div>

        <div className="border-t border-black/5 pt-5">
          <h3 className="mb-3 font-semibold">Reporter declaration</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field form={form} set={set} label="Signer name" k="declarationSignerName" req />
            <Field form={form} set={set} label="Relationship to child" k="relationshipToChild" req />
            <Field form={form} set={set} label="Signer role / designation" k="declarationSignerRole" />
            <div>
              <label className="label">Declaration method</label>
              <select className="field" value={form.declarationMethod} onChange={set('declarationMethod')}>
                {DECLARATION_METHODS.map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
              </select>
            </div>
          </div>
          <label className="mt-4 flex gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={form.declarationAccepted} onChange={setChecked('declarationAccepted')} required />
            <span>
              I declare that the information provided is true to the best of my knowledge and may be used by authorized police, SJPU, CWC/DCPU, and child-protection authorities for tracing, verification, and restoration.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={() => nav('/app')}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Submitting...' : allowDuplicate ? 'Submit duplicate anyway' : 'Submit'}</button>
        </div>
      </form>
    </div>
  );
}
