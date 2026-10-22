// Station alerts (shared/station-alerts.js): every sighting is sent to the
// police station that can get there first, on its phones, and to the
// station whose poster code was scanned. Two halves:
//   - StationAlerts, on top of Sightings for police desks: the sightings sent
//     to this station (or to this control room when no station answered),
//     with "On it" and a reply;
//   - StationAlertStatus, on a sighting's card: which station it went to,
//     whether its phones were reached, and who answered.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { asList, CategoryBadge, coordsOf, genderLabel, MapsLink, PhoneLink, ProtectedImage, timeAgo, txt } from '../lib.jsx';
import { CONCERN_REASON_LABELS } from '../sightingConcern.js';
import { msg, useT } from '../i18n.jsx';
import { useDisplay } from '../useDisplay.js';
import { usePolling } from '../usePolling.js';
import { ActionMessage, ActionToast, useAction } from './useAction.jsx';
import { CARE_ADULT, CARE_CHILD } from './LocalPolice.jsx';

const OUTCOMES = [
  { id: 'found', label: msg('Found the person') },
  { id: 'not_found', label: msg('Went to the place; the person was not there') },
  { id: 'update', label: msg('Update') },
];
const OUTCOME_LABELS = {
  on_it: msg('On it'),
  found: msg('Found the person'),
  not_found: msg('Went to the place; the person was not there'),
  update: msg('Update'),
};

function Replies({ replies }) {
  const t = useT();
  const list = asList(replies).filter((r) => r && typeof r === 'object');
  if (!list.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {list.map((r, i) => (
        <li key={`${r.at}-${i}`} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
          <span className={`font-semibold ${r.outcome === 'found' ? 'text-emerald-700' : 'text-slate-800'}`}>{t(OUTCOME_LABELS[r.outcome] || OUTCOME_LABELS.update)}</span>
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

/** Why this sighting came to this desk, in a line. */
function whyLine(t, sa) {
  if (sa.reason === 'poster') return t('Reported through your poster code “{code}”.', { code: txt(sa.posterCode) });
  if (sa.reason === 'escalated') return t('No police station said it was on it, so it came to you.');
  if (sa.distanceKm != null) return t('About {km} km from your station.', { km: sa.distanceKm });
  return t('Reported near your station.');
}

/**
 * The sightings sent to this station, or to this control room. Nothing shows
 * when there are none. `highlightId` is the sighting an alert linked to.
 */
export function StationAlerts({ highlightId = '' }) {
  const t = useT();
  const d = useDisplay();
  const action = useAction();
  const [alerts, setAlerts] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  // { [sightingId]: { outcome, note } } while a reply is being written.
  const [replying, setReplying] = useState({});
  const cardRefs = useRef({});
  const scrolledFor = useRef('');

  const load = useCallback(() => {
    api.get('/reports/found/station-alerts').then((data) => setAlerts(asList(data?.alerts))).catch(() => {});
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
  }, [highlightId, alerts]);

  if (!alerts.length) return <ActionToast action={action} />;

  // Waiting for "On it" first, then the rest still open; answered or closed
  // ones only on asking, unless an alert links to one.
  const waiting = (a) => a.status === 'open' && !a.stationAlert?.ack;
  const open = alerts.filter((a) => a.status === 'open').sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
  const closed = alerts.filter((a) => a.status !== 'open');
  const shown = showClosed || closed.some((a) => a.id === highlightId) ? [...open, ...closed] : open;

  const setForm = (id, patch) => setReplying((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }));
  const send = (a, outcome, note = '') => action.run(`sa-reply:${a.id}`, async () => {
    const data = await api.post(`/reports/found/${a.id}/station-alert/reply`, { outcome, note: note.trim() });
    if (data?.alert) setAlerts((list) => list.map((x) => (x.id === a.id ? data.alert : x)));
    setReplying((m) => ({ ...m, [a.id]: undefined }));
  }, outcome === 'on_it' ? msg('Everyone sent this sighting now knows you are on it.') : msg('Your answer was sent.'));

  return (
    <section className="space-y-3">
      <ActionToast action={action} />
      <div>
        <h2 className="text-base font-bold text-slate-900">{t('Sent to your station')}</h2>
        <p className="text-xs text-slate-500">
          {t('Sightings reported near your station or through your posters. Go to the place and tap “On it”, so the control room is not called. You see the sighting, never a case.')}
        </p>
      </div>
      {shown.length === 0 && <p className="text-xs text-slate-500">{t('Nothing is waiting for your station.')}</p>}
      {shown.map((a) => {
        const sa = a.stationAlert && typeof a.stationAlert === 'object' ? a.stationAlert : {};
        const reported = a.reportedLocation && typeof a.reportedLocation === 'object' ? a.reportedLocation : {};
        const coords = coordsOf(a);
        const form = replying[a.id];
        const ack = sa.ack && typeof sa.ack === 'object' ? sa.ack : null;
        return (
          <div
            key={a.id}
            ref={(node) => { cardRefs.current[a.id] = node; }}
            className={`card p-4 shadow-sm sm:p-5 ${waiting(a) ? 'border-l-4 border-l-red-500' : ''} ${highlightId === a.id ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">{whyLine(t, sa)}</p>
              <span className="flex items-center gap-1.5">
                <CategoryBadge category={a.personCategory} />
                {a.status !== 'open' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t('Closed')}</span>
                ) : ack ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t('Someone is on it')}</span>
                ) : (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{t('Waiting for “On it”')}</span>
                )}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <div className="h-24 w-24 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-28 sm:w-28">
                <ProtectedImage
                  src={txt(a.photoUrl)}
                  alt={t('Reported sighting')}
                  className="h-full w-full object-contain"
                  fallback={<div className="grid h-full w-full place-items-center px-2 text-center text-[11px] text-slate-400">{t('No photo — text report')}</div>}
                />
              </div>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium text-slate-800">{txt(a.geoAddress) || d(a.foundLocation)}</p>
                {txt(a.geoAddress) && <p className="text-xs text-slate-500">{d(a.foundLocation)}</p>}
                <p className="text-xs text-slate-500">
                  {d.places(reported.district || reported.districtText, reported.state)}
                  {(reported.district || reported.districtText || reported.state) ? ' · ' : ''}
                  {t('Seen {when}', { when: timeAgo(a.createdAt) })}
                </p>
                {coords && <MapsLink lat={coords.lat} lng={coords.lng} />}
                {(a.ageApprox != null || txt(a.gender)) && (
                  <p className="text-xs text-slate-600">
                    {[genderLabel(txt(a.gender), a.personCategory), a.ageApprox != null ? t('age {age}', { age: txt(a.ageApprox) }) : ''].filter(Boolean).join(' / ')}
                  </p>
                )}
                {a.concernReason && CONCERN_REASON_LABELS[a.concernReason] && (
                  <p className="text-xs text-slate-600">{t(CONCERN_REASON_LABELS[a.concernReason])}</p>
                )}
                {txt(a.note) && <p className="text-xs text-slate-700">{t('Reporter’s note: {note}', { note: txt(a.note) })}</p>}
                <p className="text-xs text-slate-600">
                  {txt(a.reporterName)}
                  {' · '}
                  {txt(a.reporterPhone) ? <PhoneLink phone={a.reporterPhone} /> : t('confidential')}
                </p>
              </div>
            </div>
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-950">{sa.adult ? t(CARE_ADULT) : t(CARE_CHILD)}</p>
            {ack && (
              <p className="mt-2 text-xs text-emerald-800">
                {t('On it: {name}, {desk}, {when}.', { name: txt(ack.byName), desk: txt(ack.desk), when: timeAgo(ack.at) })}
                {txt(ack.byPhone) && <> <PhoneLink phone={ack.byPhone} /></>}
              </p>
            )}
            <Replies replies={sa.replies} />
            {a.status === 'open' && !ack && (
              <button
                type="button"
                className="btn-primary mt-3 w-full py-3 text-sm font-bold"
                onClick={() => send(a, 'on_it')}
                disabled={action.pending}
              >
                {action.busy(`sa-reply:${a.id}`) ? t('Sending…') : t('On it')}
              </button>
            )}
            {form ? (
              <div className="mt-3 grid gap-2">
                <label className="block" htmlFor={`sa-outcome-${a.id}`}>
                  <span className="label">{t('What happened?')}</span>
                  <select
                    id={`sa-outcome-${a.id}`}
                    className="field w-full py-2 text-xs"
                    value={form.outcome || 'found'}
                    onChange={(e) => setForm(a.id, { outcome: e.target.value })}
                  >
                    {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}
                  </select>
                </label>
                <label className="block" htmlFor={`sa-note-${a.id}`}>
                  <span className="label">{(form.outcome || 'found') === 'update' ? t('Update') : t('Note (optional)')}</span>
                  <textarea
                    id={`sa-note-${a.id}`}
                    className="field w-full py-2 text-xs"
                    rows={2}
                    maxLength={500}
                    value={form.note || ''}
                    onChange={(e) => setForm(a.id, { note: e.target.value })}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary px-4 py-2 text-xs" onClick={() => send(a, form.outcome || 'found', form.note || '')} disabled={action.pending}>
                    {action.busy(`sa-reply:${a.id}`) ? t('Sending…') : t('Send')}
                  </button>
                  <button type="button" className="btn-ghost px-4 py-2 text-xs" onClick={() => setReplying((m) => ({ ...m, [a.id]: undefined }))} disabled={action.pending}>
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-ghost mt-2 w-full py-2.5 text-xs font-semibold"
                onClick={() => setForm(a.id, { outcome: 'found', note: '' })}
              >
                {t('Say what happened')}
              </button>
            )}
            <ActionMessage action={action} id={`sa-reply:${a.id}`} />
          </div>
        );
      })}
      {closed.length > 0 && (
        <button type="button" className="text-xs font-semibold text-khozo-dark underline" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? t('Hide closed sightings') : t('Show closed sightings ({n})', { n: closed.length })}
        </button>
      )}
    </section>
  );
}

/** Whether a phone was reached, in words. */
function phoneWords(t, desk) {
  const push = desk?.push?.sent ? t('app alert sent') : desk?.push?.reason === 'no_device' ? t('no app') : t('app alert failed');
  const sms = desk?.sms?.sent ? t('SMS sent') : desk?.sms?.reason === 'no_gateway' ? t('SMS not set up') : desk?.sms?.reason === 'no_phone' ? t('no number') : t('SMS failed');
  return `${push}, ${sms}`;
}

/** On a sighting's card: which station it went to, and whether anyone answered. */
export function StationAlertStatus({ f }) {
  const t = useT();
  const sa = f?.stationAlert && typeof f.stationAlert === 'object' ? f.stationAlert : null;
  if (!sa) return null;
  const desks = asList(sa.desks).filter((x) => x && typeof x === 'object');
  // One line per station, not per login.
  const stations = [...new Map(desks.map((x) => [`${x.station}|${x.reason}`, x])).values()];
  const ack = sa.ack && typeof sa.ack === 'object' ? sa.ack : null;
  const escalation = sa.escalation && typeof sa.escalation === 'object' && sa.escalation.reason ? sa.escalation : null;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-700">
      {stations.length ? (
        <ul className="space-y-0.5">
          {stations.map((x) => (
            <li key={`${x.station}|${x.reason}`}>
              <span className="font-semibold text-slate-800">
                {x.reason === 'poster'
                  ? t('Sent to {station} (their poster)', { station: txt(x.station) })
                  : x.distanceKm != null
                    ? t('Sent to {station}, {km} km away', { station: txt(x.station), km: x.distanceKm })
                    : t('Sent to {station}', { station: txt(x.station) })}
              </span>
              {' · '}
              {desks.filter((y) => y.station === x.station && y.reason === x.reason).map((y) => phoneWords(t, y)).join('; ')}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-semibold text-amber-800">{t('No police station on Khozo near this sighting.')}</p>
      )}
      {ack ? (
        <p className="mt-1 font-semibold text-emerald-800">{t('On it: {name}, {desk}, {when}.', { name: txt(ack.byName), desk: txt(ack.desk), when: timeAgo(ack.at) })}</p>
      ) : escalation ? (
        <p className="mt-1 font-semibold text-red-700">
          {escalation.reason === 'no_station'
            ? t('The control room and command centre were told {when}.', { when: timeAgo(escalation.at) })
            : t('No station said “On it” in 15 minutes. The control room and command centre were told {when}.', { when: timeAgo(escalation.at) })}
        </p>
      ) : (
        <p className="mt-1 text-amber-800">{t('Waiting for the station to say “On it”.')}</p>
      )}
    </div>
  );
}
