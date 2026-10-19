import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate, isAdultCase, missingLabel, personCategoryOf } from '../lib.jsx';
import { msg, useT } from '../i18n.jsx';
import { PublicFooter, PublicHeader, usePageMeta } from '../PublicChrome.jsx';

// Same wording as the dashboard's status badges; the code stays the lookup key.
const CASE_STATUS_LABELS = {
  missing: msg('Missing'),
  intake_pending: msg('Waiting to be checked'),
  under_review: msg('Under review'),
  found: msg('Found / Reunited'),
  closed: msg('Closed'),
};

/*
 * Where the case stands, as four stages. Each says no more than the server's
 * own status (shared/case-domain.js publicCaseStatus): registered; verified,
 * which an NGO or family intake waits on before any matching; active with
 * the agency; and found or closed.
 */
function CaseProgress({ status }) {
  const t = useT();
  const s = status.status;
  const ended = s === 'found' || s === 'closed';
  const stages = [
    { label: msg('Case registered'), done: true },
    { label: msg('Verified by an officer'), done: s !== 'intake_pending', current: s === 'intake_pending' },
    { label: msg('Active with the agency'), done: ended, current: s === 'missing' || s === 'under_review' },
    { label: s === 'closed' ? msg('Case closed') : msg('Found / traced'), done: ended, current: ended },
  ];
  return (
    <ol className="mt-6 grid gap-3 sm:grid-cols-4 sm:gap-2" aria-label={t('Case status')}>
      {stages.map((stage, i) => (
        <li key={stage.label} aria-current={stage.current ? 'step' : undefined} className="flex items-center gap-3 sm:block">
          <div className={`h-1.5 w-8 shrink-0 rounded-full sm:w-full ${stage.done ? 'bg-khozo' : stage.current ? 'bg-khozo/40' : 'bg-gray-200'}`} />
          <p className={`text-sm sm:mt-2 ${stage.current ? 'font-bold text-ink' : stage.done ? 'font-medium text-gray-700' : 'text-gray-400'}`}>
            {i + 1}. {t(stage.label)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/*
 * A family checks its own case here with the Case ID it was given at
 * registration. Only that id resolves: FIR numbers and external references are
 * guessable, so they no longer open anything publicly. The answer is progress
 * only (shared/case-domain.js publicCaseStatus): no name, age, gender, place,
 * FIR or photo, because whoever holds an id is not necessarily the family.
 */
export default function TrackCase() {
  usePageMeta({ title: msg('Track my case'), description: msg('Families can follow a registered missing-person case with its Case ID. No names, photos or addresses are shown.') });
  const t = useT();
  const [ref, setRef] = useState('');
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async (event) => {
    event.preventDefault();
    const value = ref.trim();
    if (!value) return;
    setBusy(true);
    setErr('');
    setStatus(null);
    try {
      const data = await api.get(`/reports/public/status/${encodeURIComponent(value)}`);
      setStatus(data.status || null);
    } catch (error) {
      setErr(error.status === 404
        ? msg('No case was found with this Case ID. Check it against the ID you were given, or contact the police station that registered the case.')
        : error.message);
    } finally {
      setBusy(false);
    }
  };

  const badge = status
    // A traced adult is "found", never "reunited": that is the person's choice.
    ? status.status === 'found' && isAdultCase(status)
      ? t('Found / traced')
      : CASE_STATUS_LABELS[status.status]
        ? t(CASE_STATUS_LABELS[status.status])
        : String(status.status || '').replaceAll('_', ' ')
    : '';

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f8f5]">
      <PublicHeader />

      <main className="mx-auto w-full flex-1 max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Case status')}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">{t('Track my case')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-500">
            {t('Enter the Case ID you were given when the case was registered. This page shows only how the case is progressing — never names, photos, contacts or addresses. FIR numbers and other references are not accepted here.')}
          </p>
        </div>

        <form onSubmit={lookup} className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-black/5 sm:p-5">
          <label htmlFor="case-id" className="label">{t('Case ID (given when the case was registered)')}</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="case-id"
              className="field flex-1 font-mono"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder={t('Example: r_AbC12xYz')}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button className="btn-primary" disabled={busy}>{busy ? t('Checking...') : t('Check status')}</button>
          </div>
        </form>

        {err && <div role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{t(err)}</div>}

        {status && (
          <section aria-live="polite" className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-black/5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-500">
                  {t('Case {id}', { id: status.id })}
                  {status.personCategory ? <> · {missingLabel(personCategoryOf(status))}</> : null}
                </p>
                <h2 className="mt-1 text-xl font-bold text-ink">{t(status.statusLabel)}</h2>
              </div>
              {badge && (
                <span className="rounded-full bg-khozo-light px-3 py-1 text-xs font-semibold text-khozo">{badge}</span>
              )}
            </div>

            <CaseProgress status={status} />

            <dl className="mt-6 grid gap-4 border-t border-black/5 pt-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">{t('Registered')}</dt>
                <dd className="mt-1 font-medium">{fmtDate(status.registeredAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">{t('Last updated')}</dt>
                <dd className="mt-1 font-medium">{fmtDate(status.updatedAt || status.registeredAt)}</dd>
              </div>
            </dl>

            {(status.message || status.nextStep) && (
              <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                {status.message && <p className="font-semibold text-ink">{t(status.message)}</p>}
                {status.nextStep && <p className="mt-1">{t(status.nextStep)}</p>}
              </div>
            )}
          </section>
        )}

        <p className="mt-8 text-sm text-gray-500">
          {t('Sent a sighting instead?')}{' '}
          <Link to="/track-sighting" className="font-semibold text-khozo hover:underline">{t('Track a report I made')}</Link>
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
