import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PublicActions } from '../components.jsx';
import { currentLocale, msg, useT } from '../i18n.jsx';
import { PublicFooter, PublicHeader, usePageMeta } from '../PublicChrome.jsx';

/*
 * /bulletins used to be a public gallery and name search of missing children.
 * The rule now (shared/case-domain.js isPublicAppeal) is that the public never
 * sees the name or photo of any missing person, child, woman or adult: a face
 * on a public page can lead the wrong person to someone, and a name search
 * tells anyone who asks whether a person is being looked for. The address is
 * kept because old links and printed material point here; it explains the
 * rule and offers what a member of the public can actually do.
 *
 * The only data read is the aggregate summary: counts, never a name or an id.
 */
const SUMMARY_FIELDS = [
  { key: 'activeCases', label: msg('Active cases') },
  { key: 'reunited', label: msg('Found or closed') },
  { key: 'sightingsReceived', label: msg('Sightings received') },
  { key: 'statesCovered', label: msg('States covered') },
];

const RULES = [
  msg('Anyone can send a sighting. Khozo never tells the sender who anyone is, or whether their photo matched anyone.'),
  msg('An authorised officer checks every possible match before any family is contacted.'),
  msg('A woman or adult who is traced is asked first; their family is told only with their consent.'),
];

function useSummary() {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/reports/public/summary')
      .then((d) => { if (alive) setSummary(d?.summary || null); })
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, []);
  return summary;
}

export default function Bulletins() {
  usePageMeta({ title: msg('How we protect privacy'), description: msg('Why Khozo never shows the name or photo of a missing person, and what you can do instead.') });
  const t = useT();
  const summary = useSummary();
  const counts = summary
    ? SUMMARY_FIELDS.filter((f) => Number.isFinite(Number(summary[f.key])))
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f8f5]">
      <PublicHeader />

      <main className="mx-auto w-full flex-1 max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <p className="text-xs font-semibold uppercase tracking-wide text-khozo">{t('Privacy rule')}</p>
        <h1 className="mt-1 text-3xl font-bold text-ink">{t('Khozo has no public gallery')}</h1>
        <p className="mt-3 text-gray-600">
          {t('Names and photos of missing persons are never shown to the public. If you have seen someone who seems lost, send a photo: it is compared with missing cases, and only authorised officers see who matched.')}
        </p>

        <ul className="mt-6 space-y-2 text-sm text-gray-600">
          {RULES.map((rule) => (
            <li key={rule} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-khozo" />
              <span>{t(rule)}</span>
            </li>
          ))}
        </ul>

        <PublicActions className="mt-8" />

        {counts.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{t('Khozo in numbers')}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {counts.map((f) => (
                <div key={f.key} className="rounded-xl bg-white p-4 ring-1 ring-black/5">
                  <dt className="text-xs text-gray-500">{t(f.label)}</dt>
                  <dd className="mt-1 text-2xl font-bold text-ink">
                    {Number(summary[f.key]).toLocaleString(currentLocale())}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-gray-400">{t('Totals only. No names, photos or case details.')}</p>
          </section>
        )}

        <p className="mt-10 text-sm text-gray-500">
          {t('If a child appears to be in immediate danger, call {childline} or {police} first.', { childline: '1098', police: '112' })}
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
