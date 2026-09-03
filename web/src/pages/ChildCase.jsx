import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { fmtDate } from '../lib.jsx';

/**
 * The page for one missing child, and the thing a person actually shares.
 *
 * Khozo's premise is that a stranger recognises a face and acts. That depends
 * on an appeal travelling through WhatsApp, and until this page existed there
 * was no address to send: the bulletin list could be browsed but no child could
 * be linked to. Everything here is arranged around the two things a recipient
 * of that link can do — look properly, and pass it on.
 *
 * It reads the same redacted payload the public list reads, from the same
 * function on the server, so it cannot expose a field the list would withhold.
 */

/** "Missing 4 days" — recency is what decides whether a stranger looks twice. */
function sinceLabel(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 0) return null;
  if (days === 0) return 'Missing since today';
  if (days === 1) return 'Missing 1 day';
  if (days < 31) return `Missing ${days} days`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Missing ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(days / 365);
  return `Missing ${years} year${years === 1 ? '' : 's'}`;
}

/**
 * Age and gender are the two attributes a stranger scans for after the face.
 * A bare dash for a missing value reads as a broken record and costs the child
 * a second look, so an absent field is omitted rather than rendered empty.
 */
function describe(child) {
  const bits = [];
  if (child.age != null && child.age !== '') bits.push(`${child.age} years old`);
  if (child.gender) bits.push(child.gender);
  return bits.join(' · ');
}

export default function ChildCase() {
  const { id } = useParams();
  const [child, setChild] = useState(null);
  const [state, setState] = useState('loading');
  const [shared, setShared] = useState('');

  useEffect(() => {
    let alive = true;
    setState('loading');
    api.get(`/reports/public/bulletins/${encodeURIComponent(id)}`)
      .then((d) => {
        if (!alive) return;
        setChild(d.bulletin || null);
        setState(d.bulletin ? 'ready' : 'missing');
      })
      .catch(() => alive && setState('missing'));
    return () => { alive = false; };
  }, [id]);

  // The share control is the point of the page. The native sheet is used where
  // the device has one, because on a phone that is the path into WhatsApp; the
  // clipboard is the fallback, and it always reports back so the tap is never
  // silent.
  const share = async () => {
    const url = window.location.href;
    const title = child ? `${child.childName} is missing` : 'Missing child appeal — Khozo';
    const text = child
      ? `${child.childName}${child.age != null ? `, ${child.age}` : ''} — missing from ${child.lastSeen}. If you have seen this child, report a sighting on Khozo.`
      : 'Please look at this missing-child appeal on Khozo.';
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShared('Link copied');
    } catch {
      // A cancelled share sheet lands here too, which is not an error worth
      // reporting; only say something when the clipboard genuinely failed.
      if (!navigator.share) setShared('Could not copy — select the address bar instead');
    }
    setTimeout(() => setShared(''), 3200);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4">
          <Logo />
          <Link to="/bulletins" className="text-sm font-semibold text-khozo hover:underline">
            All bulletins
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        {state === 'loading' ? (
          <div className="animate-pulse space-y-4">
            <div className="h-72 rounded-2xl bg-gray-200" />
            <div className="h-8 w-2/3 rounded bg-gray-200" />
            <div className="h-4 w-1/3 rounded bg-gray-200" />
          </div>
        ) : null}

        {state === 'missing' ? (
          <div className="rounded-2xl border border-black/5 bg-white p-8 text-center">
            <h1 className="text-2xl font-bold text-ink">This appeal is no longer public</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-gray-500">
              The bulletin may have been withdrawn, or the child may already be safe. Nothing about the
              record is shown here once it leaves public view.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/bulletins" className="btn-primary">See current appeals</Link>
              <Link to="/report" className="btn-ghost">Report a sighting</Link>
            </div>
          </div>
        ) : null}

        {state === 'ready' && child ? (
          <>
            <article className="overflow-hidden rounded-2xl border border-black/5 bg-white">
              {child.photoUrl ? (
                <img
                  src={child.photoUrl}
                  alt={`Photograph of ${child.childName}`}
                  className="aspect-[4/3] w-full bg-gray-100 object-cover"
                />
              ) : null}

              <div className="p-6 sm:p-8">
                {sinceLabel(child.dateOfMissing) ? (
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">
                    {sinceLabel(child.dateOfMissing)}
                  </p>
                ) : null}

                <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
                  {child.childName}
                </h1>

                {describe(child) ? (
                  <p className="mt-2 text-lg text-gray-600">{describe(child)}</p>
                ) : null}

                <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-gray-100 pt-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Last seen</dt>
                    <dd className="mt-0.5 font-medium text-ink">{child.lastSeen}</dd>
                  </div>
                  {child.dateOfMissing ? (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Missing since</dt>
                      <dd className="mt-0.5 font-medium text-ink">{fmtDate(child.dateOfMissing)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Appeal issued by</dt>
                    <dd className="mt-0.5 font-medium text-ink">{child.agency}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">Reference</dt>
                    <dd className="mt-0.5 font-mono text-sm text-gray-600">{child.id}</dd>
                  </div>
                </dl>
              </div>
            </article>

            {/*
              Two actions, and no third. Everything else a visitor might do is a
              text link further down, because a person who has just recognised a
              face should not have to choose between six buttons.
            */}
            <div className="sticky bottom-0 z-10 -mx-5 mt-6 grid grid-cols-2 gap-3 border-t border-black/5 bg-gray-50/95 px-5 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
              <Link
                to={`/report?child=${encodeURIComponent(child.id)}`}
                className="btn-primary justify-center py-3.5 text-base"
              >
                I have seen this child
              </Link>
              <button
                type="button"
                onClick={share}
                className="btn justify-center border border-khozo/30 bg-white py-3.5 text-base font-semibold text-khozo hover:bg-khozo-light"
              >
                Share this appeal
              </button>
            </div>

            <p aria-live="polite" className="mt-2 h-5 text-center text-sm text-khozo sm:text-left">
              {shared}
            </p>

            <p className="mt-4 text-sm text-gray-500">
              {child.instructions}
            </p>

            {/*
              The safeguards exist and were invisible to the public. A person
              deciding whether to upload a photograph of a child is owed this
              before they are asked, not in a policy page they will never open.
            */}
            <section className="mt-8 rounded-2xl border border-black/5 bg-white p-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">
                How Khozo handles this
              </h2>
              <ul className="mt-4 space-y-3 text-sm text-gray-600">
                <li>
                  <strong className="text-ink">Two engines must agree.</strong> A face comparison is a
                  prompt for an officer to look, never a decision. A possible match that only one engine
                  proposes is withheld rather than shown with a smaller number.
                </li>
                <li>
                  <strong className="text-ink">A person confirms, not a machine.</strong> A family is
                  contacted only after an authorised officer reviews both photographs and confirms.
                </li>
                <li>
                  <strong className="text-ink">This page is redacted by default.</strong> Guardian
                  contacts, identity numbers and exact addresses are never published, and every action
                  on the case is written to a tamper-evident audit record.
                </li>
              </ul>
              <p className="mt-4 text-sm text-gray-500">
                If a child appears to be in immediate danger, call <strong className="text-ink">1098</strong>{' '}
                or <strong className="text-ink">112</strong> first.
              </p>
            </section>

            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link to="/bulletins" className="text-khozo hover:underline">All current appeals</Link>
              <Link to="/track-sighting" className="text-khozo hover:underline">Track a sighting you reported</Link>
              <Link to="/services" className="text-khozo hover:underline">Find help nearby</Link>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
