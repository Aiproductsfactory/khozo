import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate, roleLabel, timeAgo } from '../lib.jsx';
import { currentLocale, useT } from '../i18n.jsx';

/**
 * CCTV checks made on police laptops with Khozo Desktop, for the cases this
 * desk can see (GET /api/dashboard/video-checks, shared/video-jobs.js): how
 * many hours of recording were read, the faces Khozo compared, the faces an
 * officer marked as the person (each a sighting waiting for the case's
 * review) and the ones marked "not the person", by district, camera and
 * officer, with the newest checks.
 *
 * No face picture, score or video fingerprint comes to this page.
 */

const WINDOWS = [7, 30, 90, 0];

function Stat({ label, value, tone = 'text-ink', hint }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Section({ title, hint, empty, children }) {
  const t = useT();
  return (
    <section className="rounded-xl bg-white ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </div>
      {empty ? <p className="px-4 py-5 text-sm text-gray-400">{t('No CCTV checks in this period.')}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

const hours = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const share = (n) => (n == null ? '-' : `${Math.round(n * 100)}%`);
/** A length of recording in words: minutes under an hour, hours above. */
const lengthOf = (t, seconds) => (seconds == null ? '-'
  : seconds < 3600 ? t('{n} min', { n: Math.max(seconds > 0 ? 1 : 0, Math.round(seconds / 60)) })
    : t('{n} h', { n: hours(seconds / 3600) }));

/** A laptop that is reading tells Khozo every few minutes; after this long with no word it has stopped or gone offline. */
const QUIET_MS = 15 * 60 * 1000;

function statusOf(t, job) {
  if (job.status === 'closed') return { label: t('Closed'), className: 'bg-slate-100 text-slate-700 ring-slate-500/20' };
  if (job.progressStatus === 'done') return { label: t('Finished'), className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' };
  if (job.progressStatus === 'error') return { label: t('Stopped with a problem'), className: 'bg-red-50 text-red-700 ring-red-600/20' };
  if (job.progressStatus === 'paused') return { label: t('Paused'), className: 'bg-amber-50 text-amber-700 ring-amber-600/20' };
  if (Date.now() - Date.parse(job.updatedAt || job.createdAt) > QUIET_MS) return { label: t('No word from the laptop'), className: 'bg-amber-50 text-amber-700 ring-amber-600/20' };
  return { label: t('Reading'), className: 'bg-sky-50 text-sky-700 ring-sky-600/20' };
}

/** One row of figures: a district, a camera or an officer. */
function FigureRow({ name, sub, count, row }) {
  return (
    <tr className="border-t border-black/5">
      <td className="px-4 py-2.5">
        <span className="font-semibold text-ink">{name}</span>
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </td>
      <td className="px-3 py-2.5 text-right">{count}</td>
      <td className="px-3 py-2.5 text-right">{hours(row.hours)}</td>
      <td className="px-3 py-2.5 text-right">{row.faces}</td>
      <td className="px-3 py-2.5 text-right">{row.likely + row.possible}</td>
      <td className={`px-3 py-2.5 text-right ${row.confirmed ? 'font-semibold text-emerald-700' : ''}`}>{row.confirmed}</td>
      <td className="px-3 py-2.5 text-right">{row.rejected}</td>
      <td className="px-3 py-2.5 text-right">{share(row.falseAlarmShare)}</td>
    </tr>
  );
}

function FigureTable({ first, count, rows }) {
  const t = useT();
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead className="text-xs uppercase tracking-wide text-gray-400">
        <tr>
          <th className="px-4 py-2 text-left font-semibold">{first}</th>
          <th className="px-3 py-2 text-right font-semibold">{count}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('Hours read')}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('Faces compared')}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('Likely or possible')}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('Marked the person')}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('Marked not the person')}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('False alarms')}</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

/** When a face was seen: the camera clock where the recording start is known, else the time into the video. */
const seenText = (t, d) => (d.seenAt
  ? new Date(d.seenAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'medium' })
  : t('{video} into the video', { video: d.videoTime || '-' }));

/**
 * One check: who ran it and on which laptop, the cameras, what was read and
 * found, the sightings it made. On the case page, without the case's name,
 * and with every decision and who made it (spec K14). A check against open
 * cases has no case: it says how many cases it searched, never which.
 */
export function CheckCard({ job, showCase = true }) {
  const t = useT();
  const status = statusOf(t, job);
  const cameras = [...new Set((job.videos || []).map((v) => v.cameraPlace).filter(Boolean))];
  const openCases = job.mode === 'open_cases';
  return (
    <div className="space-y-2 border-t border-black/5 px-4 py-3 text-sm first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {openCases ? (
          <span className="font-semibold text-ink">{t('Check against open cases')}</span>
        ) : showCase ? (
          <Link to={`/app/cases?id=${encodeURIComponent(job.reportId)}`} className="font-semibold capitalize text-ink hover:underline">
            {job.caseName || job.reportId}
            {job.caseFir && <span className="ml-1.5 font-normal normal-case text-gray-500">{t('FIR {fir}', { fir: job.caseFir })}</span>}
          </Link>
        ) : <span className="font-semibold text-ink">{cameras.join('; ') || '-'}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${status.className}`}>{status.label}</span>
      </div>
      <p className="text-gray-600">
        {t('{officer}, {role} · started {date} · last heard {ago}', {
          officer: job.createdByName || '-',
          role: roleLabel(job.createdByRole),
          date: fmtDate(job.createdAt),
          ago: timeAgo(job.updatedAt) || '-',
        })}
        {job.device && <span className="block text-xs text-gray-500">{t('Laptop: {laptop}', { laptop: job.device })}</span>}
      </p>
      {showCase ? (
        <p className="text-gray-600">
          {t('{videos} video(s) from {cameras}', { videos: (job.videos || []).length, cameras: cameras.join('; ') || '-' })}
        </p>
      ) : (
        // On the case page: each video, when its recording starts and how much of it was read,
        // so a desk can see which cameras and hours are already covered.
        <ul className="list-disc space-y-0.5 pl-5 text-gray-600">
          {(job.videos || []).map((v) => {
            const span = v.window ? (v.window.to ?? v.seconds ?? 0) - (v.window.from || 0) : v.seconds;
            return (
              <li key={v.key}>
                {t('{camera}: recording from {start}; {read} of {length} read', {
                  camera: v.cameraPlace || '-',
                  start: v.recordedFrom ? new Date(v.recordedFrom).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : t('start not given'),
                  read: lengthOf(t, v.secondsRead),
                  length: lengthOf(t, span),
                })}
                {v.lat != null && v.lng != null && (
                  <a className="ml-1.5 text-khozo-dark underline" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">{t('On the map')}</a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {openCases ? (
        <p className="text-gray-600">
          {t('{hours} hours read, {people} people seen, {faces} faces searched among {cases} open cases, {leads} close to a case', {
            hours: hours(job.hours),
            people: job.peopleSeen || 0,
            faces: job.counts?.faces || 0,
            cases: job.openCases?.casesSearched ?? '-',
            leads: job.openCases?.leads || 0,
          })}
        </p>
      ) : (
        <p className="text-gray-600">
          {t('{hours} hours read, {people} people seen, {faces} faces compared, {matches} likely or possible', {
            hours: hours(job.hours),
            people: job.peopleSeen || 0,
            faces: job.counts?.faces || 0,
            matches: (job.counts?.likely || 0) + (job.counts?.possible || 0),
          })}
        </p>
      )}
      {(job.confirmed > 0 || job.rejected > 0) && (
        <p className="text-gray-600">
          {openCases
            ? t('The officer sent {confirmed} to a case and did not send {rejected}.', { confirmed: job.confirmed, rejected: job.rejected })
            : t('The officer marked {confirmed} as the person and {rejected} as not the person.', { confirmed: job.confirmed, rejected: job.rejected })}
        </p>
      )}
      {!showCase && job.decisions?.length > 0 && (
        <details className="text-gray-600">
          <summary className="cursor-pointer font-semibold text-ink">{t('Every decision ({n})', { n: job.decisions.length })}</summary>
          <ul className="mt-1 space-y-1">
            {job.decisions.map((d) => (
              <li key={d.key}>
                <span className={d.decision === 'same' ? 'font-semibold text-emerald-700' : 'font-semibold'}>{d.decision === 'same' ? t('Same person') : t('Not this person')}</span>
                {` · ${d.cameraPlace || '-'} · ${seenText(t, d)} · `}
                {t('by {officer}, {when}', { officer: d.markedBy || '-', when: d.markedAt ? fmtDate(d.markedAt) : '-' })}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(job.sightings?.length > 0 || !showCase) && (
        <div className="flex flex-wrap gap-1.5">
          {!showCase && (
            <Link to={`/app/cctv-checks/report?case=${encodeURIComponent(job.reportId)}&job=${encodeURIComponent(job.id)}`} className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-ink ring-1 ring-black/15 hover:bg-gray-50">
              {t('Report for a court')}
            </Link>
          )}
          {(job.sightings || []).map((id, i) => (
            <Link key={id} to={`/app/sightings?id=${encodeURIComponent(id)}`} title={id} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20 hover:bg-emerald-100">
              {t('Open sighting {n}', { n: i + 1 })}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VideoChecks() {
  const t = useT();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setErr('');
    // days=0 is all time.
    api.get(`/dashboard/video-checks?days=${days}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [days]);

  useEffect(load, [load]);

  if (err) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>;
  if (!data) return <div className="text-sm text-gray-400">{t('Loading CCTV checks...')}</div>;

  const totals = data.totals || {};
  const none = !totals.checks;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">{t('CCTV checks')}</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            {t('Long CCTV recordings read on police laptops with Khozo Desktop, for the cases you can see. The recordings stay on the laptop. Every face found is a lead, not an identification.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('Period')}>
            {WINDOWS.map((w) => <option key={w} value={w}>{w ? t('Last {days} days', { days: w }) : t('All time')}</option>)}
          </select>
          <button className="btn-ghost" onClick={load}>{t('Refresh')}</button>
        </div>
      </div>

      {data.available === false && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{t('CCTV checks from the desktop app are not set up here yet.')}</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('Checks')} value={totals.checks || 0} hint={t('Cases: {cases} · Officers: {officers}', { cases: totals.cases || 0, officers: totals.officers || 0 })} />
        <Stat label={t('Hours of video read')} value={hours(totals.hours)} hint={t('Videos: {videos}', { videos: totals.videos || 0 })} />
        <Stat label={t('People seen')} value={totals.peopleSeen || 0} hint={t('{faces} faces compared by Khozo', { faces: totals.faces || 0 })} />
        <Stat label={t('Likely or possible')} value={(totals.likely || 0) + (totals.possible || 0)} hint={t('{count} where the engines did not agree', { count: totals.notAgreed || 0 })} />
        <Stat label={t('Marked the person')} value={totals.confirmed || 0} tone={totals.confirmed ? 'text-emerald-700' : 'text-ink'} hint={t('Each is a sighting for the case officer to review')} />
        <Stat label={t('Marked not the person')} value={totals.rejected || 0} />
        <Stat label={t('False alarms')} value={share(totals.falseAlarmShare)} hint={t('Of the faces an officer looked at')} />
      </div>

      <Section title={t('Newest checks')} empty={none}>
        {(data.recent || []).map((job) => <CheckCard key={job.id} job={job} />)}
      </Section>

      <Section title={t('By district')} hint={t('The district of the case.')} empty={none}>
        <FigureTable
          first={t('District')}
          count={t('Checks')}
          rows={(data.byDistrict || []).map((row) => (
            <FigureRow key={`${row.state}|${row.district}`} name={row.district || t('District not set')} sub={row.state} count={row.checks} row={row} />
          ))}
        />
      </Section>

      <Section title={t('By camera')} hint={t('Cameras with the most hours read first.')} empty={none}>
        <FigureTable
          first={t('Camera')}
          count={t('Videos')}
          rows={(data.byCamera || []).map((row) => (
            <FigureRow key={`${row.cameraPlace}|${row.district}`} name={row.cameraPlace || '-'} sub={row.district} count={row.videos} row={row} />
          ))}
        />
      </Section>

      <Section title={t('By officer')} empty={none}>
        <FigureTable
          first={t('Officer')}
          count={t('Checks')}
          rows={(data.byOfficer || []).map((row, i) => (
            <FigureRow key={`${row.name}|${i}`} name={row.name || '-'} sub={[roleLabel(row.role), row.district].filter(Boolean).join(' · ')} count={row.checks} row={row} />
          ))}
        />
      </Section>
    </div>
  );
}
