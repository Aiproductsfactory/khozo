import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { categoryLabel, fmtDate } from '../lib.jsx';
import { msg, useT } from '../i18n.jsx';
import { PublicFooter, PublicHeader, usePageMeta } from '../PublicChrome.jsx';
import { forgetReceipt, listReceipts } from '../myReports.js';
import ReceiptActions from '../ReceiptActions.jsx';
import InstallPrompt from '../InstallPrompt.jsx';

/*
 * The only three stages a sighting reporter is ever shown. The server
 * (shared/case-domain.js publicSightingStatus) collapses every internal state
 * into these so that a sighting that matched someone and one still waiting for
 * review read exactly the same: telling a stranger "matched" tells them the
 * person they photographed is being looked for. Nothing here may depend on the
 * outcome; the sentence under the stages comes from the server as it is.
 */
const STAGES = [
  { id: 'received', label: msg('Received') },
  { id: 'under_review', label: msg('Under review') },
  { id: 'closed', label: msg('Closed') },
];

function StageTrack({ stage }) {
  const t = useT();
  const at = Math.max(0, STAGES.findIndex((s) => s.id === stage));
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={t('Progress')}>
      {STAGES.map((s, i) => (
        <li key={s.id} aria-current={i === at ? 'step' : undefined}>
          <div className={`h-1.5 rounded-full ${i <= at ? 'bg-khozo' : 'bg-gray-200'}`} />
          <p className={`mt-2 text-xs font-semibold ${i === at ? 'text-ink' : i < at ? 'text-gray-500' : 'text-gray-400'}`}>
            {t(s.label)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default function TrackSighting() {
  usePageMeta({ title: msg('Track a report'), description: msg('Check what has happened to a sighting you sent to Khozo, with your receipt number.') });
  const t = useT();
  const [search] = useSearchParams();
  const [receipt, setReceipt] = useState(() => search.get('receipt') || '');
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Receipts saved on this phone when the reports were sent (myReports.js).
  const [mine, setMine] = useState(() => listReceipts());
  const resultRef = useRef(null);

  const lookup = (e) => {
    e.preventDefault();
    check(receipt);
  };

  // A shared link or the receipt screen opens this page with the number in it.
  useEffect(() => {
    const fromLink = search.get('receipt');
    if (fromLink) check(fromLink);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = async (raw) => {
    const id = String(raw || '').trim();
    if (!id) return;
    setReceipt(id);
    setBusy(true);
    setErr('');
    setStatus(null);
    try {
      const data = await api.get(`/reports/found/status/${encodeURIComponent(id)}`);
      setStatus(data.status || null);
      setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e2) {
      setErr(e2.status === 404
        ? msg('No report was found with this receipt number. Check it against the receipt you were given.')
        : e2.message);
    } finally {
      setBusy(false);
    }
  };

  const stage = STAGES.find((s) => s.id === status?.stage) || STAGES[0];

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f8f5]">
      <PublicHeader />

      <main className="mx-auto w-full flex-1 max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Receipt lookup')}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">{t('Track a report I made')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-500">
            {t('Enter the receipt number you were given after sending a sighting. Khozo shows only whether your report has been received, is under review, or is closed — never who anyone is, or whether your photo matched anyone.')}
          </p>
        </div>

        <form onSubmit={lookup} className="mt-6 rounded-xl bg-white p-4 ring-1 ring-black/5">
          <label htmlFor="receipt-id" className="label">{t('Receipt number')}</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="receipt-id"
              className="field flex-1 font-mono"
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              placeholder={t('Example: f_abc12345')}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="search"
              spellCheck={false}
            />
            <button className="btn-primary" disabled={busy}>{busy ? t('Checking...') : t('Check status')}</button>
          </div>
        </form>

        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t(err)}</div>}

        {status && (
          <section ref={resultRef} className="mt-6 scroll-mt-4 rounded-xl bg-white p-5 ring-1 ring-black/5">
            <p className="text-sm font-semibold text-gray-500">{t('Receipt {id}', { id: status.id })}</p>
            <h2 className="mt-1 text-xl font-bold text-ink">{t(stage.label)}</h2>

            <div className="mt-4">
              <StageTrack stage={stage.id} />
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-400">{t('Submitted')}</dt>
                <dd className="mt-1 font-medium">{fmtDate(status.submittedAt)}</dd>
              </div>
              {status.foundLocation && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">{t('Location you gave')}</dt>
                  {/* The reporter's own words, shown back as typed. */}
                  <dd className="mt-1 font-medium">{status.foundLocation}</dd>
                </div>
              )}
            </dl>

            {(status.message || status.nextStep) && (
              <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                {status.message && <p className="font-semibold text-ink">{t(status.message)}</p>}
                {status.nextStep && <p className="mt-1">{t(status.nextStep)}</p>}
              </div>
            )}
          </section>
        )}

        {/*
          Reports sent from this phone, kept on the phone only (the receipt
          number, the date and who was seen), so nobody has to have written the
          number down.
        */}
        {mine.length > 0 && (
          <section className="mt-6 rounded-xl bg-white p-4 ring-1 ring-black/5 sm:p-5">
            <h2 className="text-base font-semibold text-ink">{t('Reports sent from this phone')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('Only the receipt numbers are kept, on this phone alone.')}</p>
            <ul className="mt-3 divide-y divide-black/5">
              {mine.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold text-ink">{r.id}</p>
                      <p className="text-sm text-gray-500">
                        {t('Sent {date}', { date: fmtDate(r.at) })} · {categoryLabel(r.personCategory)}
                      </p>
                    </div>
                    <button type="button" className="btn-primary shrink-0" disabled={busy} onClick={() => check(r.id)}>
                      {t('Check status')}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <ReceiptActions id={r.id} align="start" />
                    <button
                      type="button"
                      className="px-2 text-sm font-semibold text-gray-500 hover:text-red-600"
                      onClick={() => setMine(forgetReceipt(r.id))}
                    >
                      {t('Remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <InstallPrompt className="mt-6" />

        <p className="mt-8 text-sm text-gray-500">
          {t('Registered a missing person?')}{' '}
          <Link to="/track-case" className="font-semibold text-khozo hover:underline">{t('Track my case')}</Link>
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
