// The police where a person was seen, when that is outside the district of the
// case the sighting may match (shared/routes/reports.js, "The police where the
// person was seen"). A strong match files a sighting under the case's district,
// so a child from an Ahmedabad case seen in Mumbai is reviewed by Ahmedabad's
// officers, who cannot go there. Two halves:
//   - AskLocalPolice, on the sighting's card: the case's officers ask the
//     police there to go to the place;
//   - LocalPoliceRequests, on the Matches page of the police asked: the
//     sighting (never the case), who is asking, and a reply.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { asList, CategoryBadge, coordsOf, genderLabel, MapsLink, PhoneLink, ProtectedImage, timeAgo, txt } from '../lib.jsx';
import { CONCERN_REASON_LABELS } from '../sightingConcern.js';
import { msg, useT } from '../i18n.jsx';
import { useDisplay } from '../useDisplay.js';
import { usePolling } from '../usePolling.js';
import { ActionMessage, ActionToast, useAction } from './useAction.jsx';

/** POLICE_ROLES in shared/scope.js: who may ask, and who may be asked. */
export const LOCAL_POLICE_ROLES = ['super_admin', 'admin', 'crime_bureau', 'police', 'sjpu', 'ahtu', 'dcrb'];

const OUTCOMES = [
  { id: 'found', label: msg('Found the person') },
  { id: 'not_found', label: msg('Went to the place; the person was not there') },
  { id: 'update', label: msg('Update') },
];
const outcomeLabel = (id) => OUTCOMES.find((o) => o.id === id)?.label || msg('Update');

export const CARE_ADULT = msg('If you find the person, ask whether they are safe and need help. They decide whether their family is told where they are.');
export const CARE_CHILD = msg('If you find the child, keep them safe and take them to the Child Welfare Committee.');

function Replies({ replies }) {
  const t = useT();
  const list = asList(replies).filter((r) => r && typeof r === 'object');
  if (!list.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {list.map((r, i) => (
        <li key={`${r.at}-${i}`} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
          <span className={`font-semibold ${r.outcome === 'found' ? 'text-emerald-700' : 'text-slate-800'}`}>{t(outcomeLabel(r.outcome))}</span>
          {txt(r.note) && <span className="text-slate-700">: {txt(r.note)}</span>}
          <span className="block text-[11px] text-slate-500">
            {txt(r.byName)}{txt(r.desk) ? ` · ${txt(r.desk)}` : ''} · {timeAgo(r.at)}
            {txt(r.byPhone) && <> · <PhoneLink phone={r.byPhone} /></>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * On a linked sighting reported outside the case's district: ask the police
 * there to help. `action` is the page's, so its toast outlives the card.
 */
export function AskLocalPolice({ f, user, action, onAsked }) {
  const t = useT();
  const d = useDisplay();
  const reported = f.reportedLocation && typeof f.reportedLocation === 'object' ? f.reportedLocation : {};
  const place = d.places(reported.district || reported.districtText, reported.state) || t('the place it was seen');
  const asked = f.localPolice && typeof f.localPolice === 'object' && f.localPolice.reportId === f.matchedReportId ? f.localPolice : null;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState(txt(user?.phone));
  const [result, setResult] = useState(null);
  const id = `local-police:${f.id}`;

  const send = () => action.run(id, async () => {
    const data = await api.post(`/reports/found/${f.id}/local-police`, { note: note.trim(), phone: phone.trim() });
    setResult({ desks: Number(data?.desksAlerted) || 0 });
    setOpen(false);
    onAsked?.(data?.foundReport);
  });

  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-950">
      <p className="text-sm font-semibold">{t('Seen outside your district: {place}', { place })}</p>
      <p className="mt-1">{t('You cannot go there. Ask the police in {place} to go to the place. They see this sighting only, never the case.', { place })}</p>
      {asked && (
        <p className="mt-2">{t('Asked {when} by {name}.', { when: timeAgo(asked.requestedAt), name: txt(asked.requestedByName) })}</p>
      )}
      {asked && <Replies replies={asked.replies} />}
      {result && (
        <p className={`mt-2 font-semibold ${result.desks ? 'text-emerald-800' : 'text-amber-800'}`}>
          {result.desks
            ? t('Sent to {n} police desks in {place}.', { n: result.desks, place })
            : t('No police desk for {place} is on Khozo yet. Phone the police there and give them the place and time of this sighting.', { place })}
        </p>
      )}
      {open ? (
        <div className="mt-2 grid gap-2">
          <label className="block" htmlFor={`lp-note-${f.id}`}>
            <span className="label">{t('Note for them (optional)')}</span>
            <textarea
              id={`lp-note-${f.id}`}
              className="field w-full py-2 text-xs"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('For example: a scar on the left hand.')}
            />
          </label>
          <label className="block" htmlFor={`lp-phone-${f.id}`}>
            <span className="label">{t('Your phone, for them to call you')}</span>
            <input
              id={`lp-phone-${f.id}`}
              className="field w-full py-2 text-xs"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              inputMode="tel"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-4 py-2 text-xs" onClick={send} disabled={action.pending}>
              {action.busy(id) ? t('Sending…') : t('Send the request')}
            </button>
            <button type="button" className="btn-ghost px-4 py-2 text-xs" onClick={() => setOpen(false)} disabled={action.pending}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="mt-2 inline-flex min-h-11 items-center font-semibold text-sky-800 underline sm:min-h-0" onClick={() => setOpen(true)}>
          {asked ? t('Ask again') : t('Ask the police there to help')}
        </button>
      )}
      <ActionMessage action={action} id={id} />
    </div>
  );
}

/**
 * Sightings other police have asked this desk to help with. Nothing shows
 * when there are none. `highlightId` is the sighting an alert linked to.
 */
export function LocalPoliceRequests({ highlightId = '' }) {
  const t = useT();
  const d = useDisplay();
  const action = useAction();
  const [requests, setRequests] = useState([]);
  // { [sightingId]: { outcome, note } } while a reply is being written.
  const [replying, setReplying] = useState({});
  const cardRefs = useRef({});
  const scrolledFor = useRef('');

  const load = useCallback(() => {
    api.get('/reports/found/local-police').then((data) => setRequests(asList(data?.requests))).catch(() => {});
  }, []);
  useEffect(load, [load]);
  usePolling(load, 30000);

  useEffect(() => {
    if (!highlightId || scrolledFor.current === highlightId) return;
    const node = cardRefs.current[highlightId];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledFor.current = highlightId;
    }
  }, [highlightId, requests]);

  if (!requests.length) return <ActionToast action={action} />;

  const setForm = (id, patch) => setReplying((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }));
  const reply = (r) => {
    const form = replying[r.id] || {};
    return action.run(`lp-reply:${r.id}`, async () => {
      const data = await api.post(`/reports/found/${r.id}/local-police/reply`, { outcome: form.outcome, note: (form.note || '').trim() });
      if (data?.request) setRequests((list) => list.map((x) => (x.id === r.id ? data.request : x)));
      setReplying((m) => ({ ...m, [r.id]: undefined }));
    }, msg('Your reply was sent to the police who asked.'));
  };

  return (
    <section className="space-y-3">
      <ActionToast action={action} />
      <div>
        <h2 className="text-base font-bold text-slate-900">{t('Requests from other police')}</h2>
        <p className="text-xs text-slate-500">
          {t('Police elsewhere ask you to go to a place in your area where someone they are looking for may have been seen. You see the sighting, not their case.')}
        </p>
      </div>
      {requests.map((r) => {
        const lp = r.localPolice && typeof r.localPolice === 'object' ? r.localPolice : {};
        const reported = r.reportedLocation && typeof r.reportedLocation === 'object' ? r.reportedLocation : {};
        const coords = coordsOf(r);
        const form = replying[r.id];
        return (
          <div
            key={r.id}
            ref={(node) => { cardRefs.current[r.id] = node; }}
            className={`card p-4 shadow-sm sm:p-5 ${highlightId === r.id ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">{t('From police in {place}', { place: txt(lp.requestedFrom) })}</p>
              <CategoryBadge category={r.personCategory} />
            </div>
            <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <div className="h-24 w-24 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-28 sm:w-28">
                <ProtectedImage
                  src={txt(r.photoUrl)}
                  alt={t('Reported sighting')}
                  className="h-full w-full object-contain"
                  fallback={<div className="grid h-full w-full place-items-center px-2 text-center text-[11px] text-slate-400">{t('No photo — text report')}</div>}
                />
              </div>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium text-slate-800">{txt(r.geoAddress) || d(r.foundLocation)}</p>
                {txt(r.geoAddress) && <p className="text-xs text-slate-500">{d(r.foundLocation)}</p>}
                <p className="text-xs text-slate-500">
                  {d.places(reported.district || reported.districtText, reported.state)}
                  {' · '}
                  {t('Seen {when}', { when: timeAgo(r.createdAt) })}
                </p>
                {coords && <MapsLink lat={coords.lat} lng={coords.lng} />}
                {(r.ageApprox != null || txt(r.gender)) && (
                  <p className="text-xs text-slate-600">
                    {[genderLabel(txt(r.gender), r.personCategory), r.ageApprox != null ? t('age {age}', { age: txt(r.ageApprox) }) : ''].filter(Boolean).join(' / ')}
                  </p>
                )}
                {r.concernReason && CONCERN_REASON_LABELS[r.concernReason] && (
                  <p className="text-xs text-slate-600">{t(CONCERN_REASON_LABELS[r.concernReason])}</p>
                )}
                {txt(r.note) && <p className="text-xs text-slate-700">{t('Reporter’s note: {note}', { note: txt(r.note) })}</p>}
                <p className="text-xs text-slate-600">
                  {txt(r.reporterName)}
                  {' · '}
                  {txt(r.reporterPhone) ? <PhoneLink phone={r.reporterPhone} /> : t('confidential')}
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-950">
              <p>
                <span className="font-semibold">{txt(lp.requestedByName)}</span>
                {txt(lp.contactPhone) && <> · <PhoneLink phone={lp.contactPhone} /></>}
                {' · '}
                {timeAgo(lp.requestedAt)}
              </p>
              {txt(lp.note) && <p className="mt-1">{txt(lp.note)}</p>}
              <p className="mt-1 font-medium">{lp.adult ? t(CARE_ADULT) : t(CARE_CHILD)}</p>
            </div>
            <Replies replies={lp.replies} />
            {form ? (
              <div className="mt-3 grid gap-2">
                <label className="block" htmlFor={`lp-outcome-${r.id}`}>
                  <span className="label">{t('What happened?')}</span>
                  <select
                    id={`lp-outcome-${r.id}`}
                    className="field w-full py-2 text-xs"
                    value={form.outcome || 'found'}
                    onChange={(e) => setForm(r.id, { outcome: e.target.value })}
                  >
                    {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}
                  </select>
                </label>
                <label className="block" htmlFor={`lp-reply-note-${r.id}`}>
                  <span className="label">{(form.outcome || 'found') === 'update' ? t('Update') : t('Note (optional)')}</span>
                  <textarea
                    id={`lp-reply-note-${r.id}`}
                    className="field w-full py-2 text-xs"
                    rows={2}
                    maxLength={500}
                    value={form.note || ''}
                    onChange={(e) => setForm(r.id, { note: e.target.value })}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary px-4 py-2 text-xs" onClick={() => reply(r)} disabled={action.pending}>
                    {action.busy(`lp-reply:${r.id}`) ? t('Sending…') : t('Send the reply')}
                  </button>
                  <button type="button" className="btn-ghost px-4 py-2 text-xs" onClick={() => setReplying((m) => ({ ...m, [r.id]: undefined }))} disabled={action.pending}>
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost mt-3 w-full py-2.5 text-xs font-semibold"
                onClick={() => setForm(r.id, { outcome: 'found', note: '' })}
              >
                {t('Reply to the police who asked')}
              </button>
            )}
            <ActionMessage action={action} id={`lp-reply:${r.id}`} />
          </div>
        );
      })}
    </section>
  );
}
