import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { fmtDate, isAdultCase, missingLabel, personCategoryOf } from '../lib.jsx';
import { LanguageSwitcher, msg, useT } from '../i18n.jsx';

// Same wording as the dashboard's status badges; the code stays the lookup key.
const CASE_STATUS_LABELS = {
  missing: msg('Missing'),
  intake_pending: msg('Intake pending'),
  under_review: msg('Under review'),
  found: msg('Found / Reunited'),
  closed: msg('Closed'),
};

/*
 * A family checks its own case here with the Case ID it was given at
 * registration. Only that id resolves: FIR numbers and external references are
 * guessable, so they no longer open anything publicly. The answer is progress
 * only (shared/case-domain.js publicCaseStatus): no name, age, gender, place,
 * FIR or photo, because whoever holds an id is not necessarily the family.
 */
export default function TrackCase() {
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
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <Link to="/report" className="btn-primary hidden sm:inline-flex">{t('Submit sighting')}</Link>
            <Link to="/" className="btn-ghost">{t('Home')}</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Case status')}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">{t('Track my case')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-500">
            {t('Enter the Case ID you were given when the case was registered. This page shows only how the case is progressing — never names, photos, contacts or addresses. FIR numbers and other references are not accepted here.')}
          </p>
        </div>

        <form onSubmit={lookup} className="mt-6 rounded-xl bg-white p-4 ring-1 ring-black/5">
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

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t(err)}</div>}

        {status && (
          <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-black/5">
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

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
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
    </div>
  );
}
