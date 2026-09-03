import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { useAuth } from '../auth.jsx';

/**
 * The home page.
 *
 * Rebuilt around a single decision: this page exists to move a visitor toward a
 * child, not toward the product. The previous version opened with a slogan, six
 * calls to action of near-equal weight (the loudest being an APK download), and
 * a statistics panel whose most prominent figure was "Reunited: 0". A person who
 * had just recognised a face on the street had no way to search, and no child
 * was visible above the fold.
 *
 * So the order is now: who is missing, what you can do, then everything else.
 * The faces are real records, each one linking to its own shareable page.
 */

/* ------------------------------------------------------------------ icons */
/*
 * A small stroked set, sized by the text around them. Emoji used to do this
 * job: they cannot inherit weight or colour, they render differently on every
 * platform, and the flag emoji in this file once shipped to production as the
 * letters "IN" on Windows.
 */
const Icon = {
  search: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" />
    </svg>
  ),
  arrow: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  shield: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  pin: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" />
    </svg>
  ),
  eyes: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ utils */

/** Recency decides whether a stranger looks twice, so it leads every card. */
function sinceLabel(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 0) return null;
  if (days === 0) return 'Missing today';
  if (days === 1) return 'Missing 1 day';
  if (days < 31) return `Missing ${days} days`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Missing ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(days / 365);
  return `Missing ${years} year${years === 1 ? '' : 's'}`;
}

/** An absent age is omitted, never rendered as a dash beside a child's name. */
function describe(child) {
  const bits = [];
  if (child.age != null && child.age !== '') bits.push(`${child.age}`);
  if (child.gender) bits.push(child.gender);
  return bits.join(' · ');
}

/* -------------------------------------------------------------------- nav */

function Nav() {
  const { user } = useAuth();
  return (
    <header className="border-b border-black/5 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Logo />
        <div className="hidden items-center gap-7 text-sm font-medium text-gray-600 md:flex">
          <Link to="/bulletins" className="hover:text-ink">Missing children</Link>
          <Link to="/report" className="hover:text-ink">Report a sighting</Link>
          <Link to="/track-case" className="hover:text-ink">Track a case</Link>
          <Link to="/services" className="hover:text-ink">Find help</Link>
        </div>
        {user ? (
          <Link to="/app" className="btn-primary">Dashboard</Link>
        ) : (
          <Link to="/login" className="text-sm font-semibold text-khozo hover:underline">
            Officer log in
          </Link>
        )}
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------- hero */

function Hero({ count, state, onSearch, query, setQuery, featured }) {
  return (
    <section className="border-b border-black/5 bg-white">
      {/*
        On a wide screen the right column holds the most recent appeal rather
        than decoration: the page argues that a real child is waiting, so it
        shows that child. Below lg it is hidden, because the grid underneath is
        already the first thing past the fold.
      */}
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-10 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-16">
        <div>
          <div className="max-w-2xl">
            {/*
              The real number of published appeals. It replaces a four-tile
              statistics panel whose most prominent figure was "Reunited: 0" — an
              honest number, but a strange thing to lead with when the page's job
              is to get a stranger to look at a face.
            */}
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-khozo">
              {state ? `Active appeals · ${state}` : 'Active appeals'}
            </p>
            <h1 className="mt-3 text-[2.6rem] font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl">
              {count === null ? (
                <span className="text-gray-300">Loading appeals…</span>
              ) : count === 0 ? (
                <>No child is currently on public appeal.</>
              ) : (
                <>
                  <span className="text-khozo">{count}</span>{' '}
                  {count === 1 ? 'child is missing' : 'children are missing'}
                  <br className="hidden sm:block" /> and someone is looking for them.
                </>
              )}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
              If you think you have seen one of them, a photograph from your phone is enough. An officer
              checks every report before any family is contacted.
            </p>
          </div>

          {/* One field, then one action. Everything else is a text link. */}
          <form onSubmit={onSearch} className="mt-8 flex max-w-xl flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Icon.search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
                inputMode="search"
                aria-label="Search by a child’s name or a place"
                placeholder="Search a name or a place"
                className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-12 pr-4 text-base text-ink shadow-sm outline-none transition focus:border-khozo focus:ring-2 focus:ring-khozo/20"
              />
            </div>
            <button type="submit" className="btn-primary justify-center px-6 py-3.5 text-base">
              Search
            </button>
          </form>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link to="/report" className="inline-flex items-center gap-1.5 font-semibold text-khozo hover:underline">
              I have seen a child <Icon.arrow className="h-4 w-4" />
            </Link>
            <Link to="/register" className="font-medium text-gray-600 hover:text-ink">My child is missing</Link>
            <Link to="/track-sighting" className="font-medium text-gray-600 hover:text-ink">Track a report I made</Link>
          </div>
        </div>

        {featured ? (
          <div className="hidden lg:block">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-gray-400">
              Most recent appeal
            </p>
            <ChildCard child={featured} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- the faces */

function ChildCard({ child }) {
  const since = sinceLabel(child.dateOfMissing);
  const meta = describe(child);
  return (
    <Link
      to={`/child/${encodeURIComponent(child.id)}`}
      className="group block overflow-hidden rounded-2xl border border-black/5 bg-white transition hover:border-khozo/40 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-khozo"
    >
      {child.photoUrl ? (
        <img
          src={child.photoUrl}
          alt={`Photograph of ${child.childName}`}
          loading="lazy"
          className="aspect-[4/5] w-full bg-gray-100 object-cover"
        />
      ) : (
        <div className="grid aspect-[4/5] w-full place-content-center bg-gray-100 text-center text-sm text-gray-400">
          No photograph
          <br />on this appeal
        </div>
      )}
      <div className="p-4">
        {since ? (
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">{since}</p>
        ) : null}
        <p className="mt-1 truncate text-lg font-bold leading-tight text-ink group-hover:text-khozo-dark">
          {child.childName}
        </p>
        {meta ? <p className="mt-0.5 text-sm text-gray-500">{meta}</p> : null}
        <p className="mt-2 flex items-start gap-1.5 text-sm text-gray-500">
          <Icon.pin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span className="line-clamp-2">{child.lastSeen}</span>
        </p>
      </div>
    </Link>
  );
}

function MissingNow({ children: rows, loading, query }) {
  return (
    <section id="missing" className="mx-auto max-w-6xl px-5 py-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {query ? `Results for “${query}”` : 'Children on appeal now'}
          </h2>
          <p className="mt-1.5 text-gray-500">
            Tap a child to see the full appeal and share it.
          </p>
        </div>
        <Link to="/bulletins" className="inline-flex items-center gap-1.5 text-sm font-semibold text-khozo hover:underline">
          All appeals and recovered records <Icon.arrow className="h-4 w-4" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse overflow-hidden rounded-2xl border border-black/5 bg-white">
              <div className="aspect-[4/5] w-full bg-gray-200" />
              <div className="space-y-2 p-4">
                <div className="h-3 w-1/2 rounded bg-gray-200" />
                <div className="h-4 w-2/3 rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((c) => <ChildCard key={c.id} child={c} />)}
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-gray-200 p-10 text-center">
          <p className="font-semibold text-ink">
            {query ? 'No appeal matches that search.' : 'No child is currently on public appeal.'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            {query
              ? 'Try a place instead of a name, or look through every current appeal.'
              : 'When an officer publishes an appeal it appears here immediately.'}
          </p>
          <Link to="/bulletins" className="btn-ghost mt-5">See all records</Link>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- how / trust */

const STEPS = [
  {
    t: 'You send a photograph',
    d: 'From the street, in under a minute. No account, no login. You get a receipt you can track.',
  },
  {
    t: 'Two engines compare faces',
    d: 'An Indian provider proposes a candidate; a second, independent engine has to agree before any officer sees it.',
  },
  {
    t: 'An officer decides',
    d: 'The jurisdiction’s police station and child-welfare desk are alerted with the location. A person confirms — never the software.',
  },
];

function How() {
  return (
    <section id="how" className="border-y border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          What happens after you send a photograph
        </h2>
        <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.t} className="relative">
              <span className="font-mono text-sm font-semibold text-khozo">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 text-lg font-bold text-ink">{s.t}</h3>
              <p className="mt-2 text-gray-600">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/*
 * The safeguards were real and entirely invisible to the public. Someone being
 * asked to upload a photograph of a child is owed this before they are asked,
 * not in a policy page they will never open.
 */
const TRUST = [
  {
    icon: Icon.eyes,
    t: 'A score is never a decision',
    d: 'A face comparison tells an officer where to look. A candidate only one engine proposes is withheld, not shown with a smaller number.',
  },
  {
    icon: Icon.shield,
    t: 'Redacted by default',
    d: 'Guardian contacts, identity numbers and exact addresses are never published. Photographs are stored against the case, never on a public screen.',
  },
  {
    icon: Icon.pin,
    t: 'An auditable record',
    d: 'Every action on a case — who looked, who confirmed, when a family was contacted — is written to a tamper-evident audit chain the Department can verify later.',
  },
];

function Trust() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          What happens to a child’s photograph
        </h2>
        <p className="mt-3 text-gray-600">
          Khozo handles biometric data about children. These are the rules it holds itself to, and they
          are enforced in the software rather than promised in a policy.
        </p>
      </div>
      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-3">
        {TRUST.map(({ icon: Ico, t, d }) => (
          <div key={t}>
            <Ico className="h-6 w-6 text-khozo" />
            <h3 className="mt-3 font-bold text-ink">{t}</h3>
            <p className="mt-1.5 text-gray-600">{d}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 border-t border-gray-100 pt-6 text-gray-600">
        If a child appears to be in immediate danger, call{' '}
        <strong className="text-ink">1098</strong> or <strong className="text-ink">112</strong> first.
        Khozo does not replace an emergency call.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------- sovereignty */

/*
 * Sovereign AI, stated plainly and only where it is true.
 *
 * Every claim here was checked against the running code before it was written:
 * the primary engine is Aarakshak (worker/src/match.js), the confirming engine
 * is pinned to ap-south-1 (worker/src/rekognition.js), and a candidate really is
 * withheld unless both agree. A parent handing over a photograph of their child
 * is owed a straight answer about where it goes, and a claim on this page the
 * code did not support would be worse than saying nothing at all.
 */
function Sovereignty() {
  return (
    <section id="sovereign" className="bg-ink text-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">Sovereign AI</p>
            <h2 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
              A child’s face never leaves India.
            </h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-white/70">
              Biometric matching for missing children runs on Indian infrastructure, by an Indian
              provider. Nothing about a child is shipped abroad to be compared.
            </p>
            <a
              href="https://aarakshak.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-lime-300 hover:underline"
            >
              About Aarakshak <Icon.arrow className="h-4 w-4" />
            </a>
          </div>

          <dl className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2">
            <div className="bg-ink p-6">
              <dt className="text-sm font-bold text-lime-300">Indian recognition engine</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                Face comparison is performed by{' '}
                <a
                  href="https://aarakshak.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white underline underline-offset-2 hover:text-lime-300"
                >
                  Aarakshak
                </a>
                , an Indian sovereign face-recognition model, under Government authorisation.
              </dd>
            </div>
            <div className="bg-ink p-6">
              <dt className="text-sm font-bold text-lime-300">Processed in Mumbai</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                The confirming engine is pinned to the{' '}
                <span className="font-mono text-white">ap-south-1</span> region. Photographs are not sent
                to overseas regions for comparison.
              </dd>
            </div>
            <div className="bg-ink p-6">
              <dt className="text-sm font-bold text-lime-300">Two engines must agree</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                One engine proposing a face is a lead, not a match. A candidate reaches an officer only
                when a second, independent engine confirms it — otherwise it is withheld.
              </dd>
            </div>
            <div className="bg-ink p-6">
              <dt className="text-sm font-bold text-lime-300">Records stay with the State</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                Cases, photographs and the audit trail remain in the Department’s own database, on Indian
                infrastructure, under its jurisdiction.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- for agencies */

const AUDIENCES = [
  ['Police & SJPU', 'Register FIRs, review citizen sightings, confirm a match and alert the family — with every action written to a tamper-evident record.'],
  ['CWC, DCPU & CCIs', 'Native roles for the child-protection desks the Juvenile Justice Act actually names, with production-compliance and care registers.'],
  ['State & national oversight', 'Caseload, reunification and coverage by district, so gaps are visible before a pilot begins rather than after it fails.'],
];

function ForAgencies() {
  return (
    <section id="agencies" className="border-y border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Built for the desks that act</h2>
          <p className="mt-3 text-gray-600">
            Khozo is one workflow from a citizen’s photograph to a restored child — report, verify, match,
            refer, restore — not a police tool with welfare bolted on.
          </p>
        </div>
        <dl className="mt-10 grid gap-8 sm:grid-cols-3">
          {AUDIENCES.map(([t, d]) => (
            <div key={t}>
              <dt className="font-bold text-ink">{t}</dt>
              <dd className="mt-1.5 text-gray-600">{d}</dd>
            </div>
          ))}
        </dl>
        <Link to="/register" className="btn-primary mt-10 inline-flex">Request access for your agency</Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- ministry + the app */

function ProposedTo() {
  const [showPortrait, setShowPortrait] = useState(true);
  return (
    <section className="border-b border-black/5 bg-khozo-light/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:gap-7">
        {showPortrait ? (
          <img
            src="/assets/minister-wcd-maharashtra.jpg"
            alt="Hon'ble Smt. Aditi Sunil Tatkare, Cabinet Minister, Department of Women and Child Development, Government of Maharashtra"
            onError={() => setShowPortrait(false)}
            className="h-24 w-24 shrink-0 rounded-2xl object-cover ring-1 ring-lime-200"
          />
        ) : null}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-khozo-dark">
            Presented to
          </p>
          <h2 className="mt-1 text-lg font-bold leading-snug text-ink">
            Department of Women and Child Development, Government of Maharashtra
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-semibold text-ink">Hon&rsquo;ble Smt. Aditi Sunil Tatkare</span>,
            Cabinet Minister, Women and Child Development — aligned to Mission Vatsalya.
          </p>
        </div>
      </div>
    </section>
  );
}

function GetApp() {
  return (
    <section className="border-t border-black/5 bg-khozo-light/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Khozo on your phone</h2>
          <p className="mt-1.5 max-w-xl text-gray-600">
            For officers on the ground: alerts with the sighting’s location, offline reporting that sends
            when signal returns. Free, Android 7.0 or newer.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            The app installs directly rather than through the Play Store, so Android will ask you to allow
            installs from your browser once.
          </p>
        </div>
        <a
          href="https://github.com/swastikkumar-alt/khozo/releases/latest/download/app-release.apk"
          download
          className="btn-ghost shrink-0 justify-center"
        >
          Download the Android app
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-gray-400">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo light />
          <p className="mt-4 max-w-sm text-sm">
            An initiative of <span className="font-semibold text-white">Aegis School of Data Science &amp; AI</span> and{' '}
            <a
              href="https://aiproductsfactory.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-white underline hover:text-lime-300"
            >
              AI Products factory
            </a>
            , under AI for Social Good.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
          <Link to="/bulletins" className="hover:text-white">Missing children</Link>
          <Link to="/report" className="hover:text-white">Report a sighting</Link>
          <Link to="/track-case" className="hover:text-white">Track a case</Link>
          <Link to="/track-sighting" className="hover:text-white">Track a report</Link>
          <Link to="/services" className="hover:text-white">Find help nearby</Link>
          <Link to="/grievance" className="hover:text-white">Raise a grievance</Link>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs">
          khozo.org · © {new Date().getFullYear()} · Emergency: call 1098 or 112
        </p>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------- page */

export default function Landing() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    api.get('/reports/public/summary')
      .then((d) => alive && setSummary(d.summary || null))
      .catch(() => alive && setSummary(null));
    return () => { alive = false; };
  }, []);

  // The list is loaded from the server on every search rather than filtered in
  // the browser: the endpoint caps at 100 records, so a client-side filter would
  // quietly search only the newest hundred and say nothing about the rest.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const url = applied
      ? `/reports/public/search?status=missing&q=${encodeURIComponent(applied)}`
      : '/reports/public/bulletins';
    api.get(url)
      .then((d) => {
        if (!alive) return;
        setRows((applied ? d.results : d.bulletins) || []);
      })
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [applied]);

  const onSearch = (e) => {
    e.preventDefault();
    setApplied(query.trim());
    document.getElementById('missing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Where the appeals actually are, so the count above the fold is specific
  // rather than a national abstraction.
  const state = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.state).filter(Boolean))];
    return names.length === 1 ? names[0] : null;
  }, [rows]);

  const count = loading && !rows.length ? null : (applied ? rows.length : (summary?.publicBulletins ?? rows.length));

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <Hero
        featured={!applied && rows.length ? rows[0] : null}
        count={count}
        state={applied ? null : state}
        query={query}
        setQuery={setQuery}
        onSearch={onSearch}
      />
      <ProposedTo />
      {/*
        With no appeal published, the headline already says so at full size —
        repeating it under a "Children on appeal now" heading, above an empty
        box, said the same thing three times and made the page look broken
        rather than quiet. The section returns the moment an officer publishes.
        An empty *search* still renders, because there the visitor asked a
        question and is owed an answer.
      */}
      {loading || rows.length || applied ? (
        <MissingNow children={rows} loading={loading} query={applied} />
      ) : null}
      <How />
      <Trust />
      <Sovereignty />
      <ForAgencies />
      <GetApp />
      <Footer />
    </div>
  );
}
