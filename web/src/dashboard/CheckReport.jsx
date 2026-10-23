import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { currentLocale, useT } from '../i18n.jsx';

/**
 * A CCTV check's report, for a court or an enquiry (spec F19; GET
 * /api/reports/:id/video-jobs/:jobId/report): the case, the officer, each
 * video with its fingerprint, camera and recording start, how much was read,
 * what was found, and each decision. Printed (or saved as a PDF) from the
 * browser; the signed file can be downloaded and checked later
 * (POST /api/dashboard/export/verify). No face picture is in it.
 */

const when = (iso) => (iso ? new Date(iso).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'medium' }) : '-');
const minutes = (s) => (s == null ? '-' : s < 3600 ? `${Math.max(s > 0 ? 1 : 0, Math.round(s / 60))} min` : `${(s / 3600).toFixed(1)} h`);

function Row({ label, children }) {
  return (
    <tr className="border-t border-black/10">
      <th className="w-48 py-1.5 pr-3 text-left align-top text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</th>
      <td className="py-1.5 text-sm">{children}</td>
    </tr>
  );
}

export default function CheckReport() {
  const t = useT();
  const [search] = useSearchParams();
  const caseId = search.get('case') || '';
  const jobId = search.get('job') || '';
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    api.get(`/reports/${encodeURIComponent(caseId)}/video-jobs/${encodeURIComponent(jobId)}/report`)
      .then(setReport)
      .catch((e) => setErr(e.message));
  }, [caseId, jobId]);

  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `khozo-cctv-check-${jobId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (err) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>;
  if (!report) return <div className="text-sm text-gray-400">{t('Loading the report...')}</div>;

  const { check } = report;
  return (
    <div className="space-y-5">
      {/* Printing shows the report alone, without the console around it. */}
      <style>{'@media print { body * { visibility: hidden !important; } #cctv-report, #cctv-report * { visibility: visible !important; } #cctv-report { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }'}</style>
      <div className="no-print flex flex-wrap items-center gap-2">
        <Link to={`/app/cases?id=${encodeURIComponent(caseId)}`} className="btn-ghost">← {t('Back to the case')}</Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>{t('Print or save as PDF')}</button>
        <button type="button" className="btn-ghost" onClick={download}>{t('Download the signed file')}</button>
      </div>

      <article id="cctv-report" className="space-y-5 rounded-xl bg-white p-6 ring-1 ring-black/5">
        <header>
          <h2 className="text-2xl font-bold">{t('CCTV check report')}</h2>
          <p className="text-sm text-gray-500">{t('Made {date} by Khozo', { date: when(report.generatedAt) })}</p>
        </header>

        <table className="w-full"><tbody>
          <Row label={t('Case')}>{[report.case.name, report.case.id, report.case.fir && t('FIR {fir}', { fir: report.case.fir })].filter(Boolean).join(' · ')}</Row>
          <Row label={t('Check')}>{check.id}</Row>
          <Row label={t('Officer')}>{[check.officer, check.role, check.officerPlace?.district].filter(Boolean).join(' · ')}</Row>
          <Row label={t('Started')}>{when(check.startedAt)}{check.closedAt ? ` · ${t('Closed {date}', { date: when(check.closedAt) })}` : ''}</Row>
          <Row label={t('Read with')}>{[check.app && `Khozo Desktop ${check.app}`, check.model, check.laptop && t('Laptop: {laptop}', { laptop: check.laptop })].filter(Boolean).join(' · ') || '-'}</Row>
          {check.live && <Row label={t('Live camera')}>{t('Watched live from {start} until {until}', { start: when(check.live.startedAt), until: when(check.live.until) })}</Row>}
          {check.caseTemplateOnLaptop && (
            <Row label={t('Case face signatures on the laptop')}>
              {check.caseTemplateOnLaptop.deletedAt ? t('Kept encrypted for the check, deleted {date}', { date: when(check.caseTemplateOnLaptop.deletedAt) }) : t('Kept encrypted for the check; not deleted yet')}
            </Row>
          )}
          <Row label={t('Found')}>{t('{hours} hours read, {people} people seen, {faces} faces compared, {matches} likely or possible', {
            hours: report.totals.hours, people: report.totals.peopleSeen, faces: report.totals.faces?.faces || 0,
            matches: (report.totals.faces?.likely || 0) + (report.totals.faces?.possible || 0),
          })}</Row>
        </tbody></table>

        <section>
          <h3 className="mb-2 font-semibold">{t('Videos')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="py-1.5 pr-3">{t('Camera')}</th><th className="py-1.5 pr-3">{t('Recording from')}</th><th className="py-1.5 pr-3">{t('Read')}</th><th className="py-1.5 pr-3">{t('Faces compared')}</th><th className="py-1.5">{t('File and its fingerprint (SHA-256)')}</th></tr>
              </thead>
              <tbody>
                {report.videos.map((v) => (
                  <tr key={`${v.name}|${v.sha256}`} className="border-t border-black/10 align-top">
                    <td className="py-1.5 pr-3">{v.cameraPlace}{v.lat != null ? <span className="block text-xs text-gray-500">{v.lat}, {v.lng}</span> : null}</td>
                    <td className="py-1.5 pr-3">{when(v.recordedFrom)}</td>
                    <td className="py-1.5 pr-3">{t('{read} of {length}', { read: minutes(v.secondsRead), length: minutes(v.window ? (v.window.to ?? v.seconds ?? 0) - (v.window.from || 0) : v.seconds) })}</td>
                    <td className="py-1.5 pr-3">{v.faces?.faces || 0}</td>
                    <td className="py-1.5"><span className="block">{v.name || '-'}</span><code className="break-all text-xs text-gray-600">{v.sha256 || t('not known')}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">{t('What the officer decided')}</h3>
          {report.decisions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="py-1.5 pr-3">{t('Seen')}</th><th className="py-1.5 pr-3">{t('Camera')}</th><th className="py-1.5 pr-3">{t('Decision')}</th><th className="py-1.5 pr-3">{t('Face engines')}</th><th className="py-1.5">{t('Marked by')}</th></tr>
                </thead>
                <tbody>
                  {report.decisions.map((d) => (
                    <tr key={d.key} className="border-t border-black/10 align-top">
                      <td className="py-1.5 pr-3">{d.seenAt ? when(d.seenAt) : '-'}<span className="block text-xs text-gray-500">{t('{t} into the video', { t: d.videoTime || '-' })}</span></td>
                      <td className="py-1.5 pr-3">{d.cameraPlace || '-'}</td>
                      <td className="py-1.5 pr-3">{d.decision === 'same' ? t('Same person') : t('Not this person')}{d.sightingId ? <span className="block text-xs text-gray-500">{t('Sighting {id}', { id: d.sightingId })}</span> : null}</td>
                      <td className="py-1.5 pr-3">{d.verdict || '-'}</td>
                      <td className="py-1.5">{d.markedBy || '-'}<span className="block text-xs text-gray-500">{when(d.markedAt)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-500">{t('No face was marked.')}</p>}
        </section>

        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('Every result is a lead, not an identification. A face marked as the person is a sighting waiting for the case officer\'s review.')}</p>

        <footer className="border-t border-black/10 pt-3 text-xs text-gray-600">
          <p>{t('Signed by Khozo with key {key}. To check a copy, upload the signed file to Khozo\'s export check.', { key: report.signature.keyId })}</p>
          <p className="mt-1 break-all font-mono">SHA-256 {report.signature.digest}</p>
          <p className="break-all font-mono">HMAC {report.signature.value}</p>
        </footer>
      </article>
    </div>
  );
}
