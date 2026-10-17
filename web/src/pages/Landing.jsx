import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components.jsx';
import { useAuth } from '../auth.jsx';
import { useT, msg, LanguageSwitcher } from '../i18n.jsx';
import InstallPrompt from '../InstallPrompt.jsx';

/**
 * The home page.
 *
 * Built around one action: a person who has seen someone who seems lost sends a
 * photograph. It does not show who is missing. The platform rule is that the
 * public never sees the name or photograph of a missing person: faces are
 * compared by the engines, only authorised officers see who matched, and a
 * registered parent sees only their own child after logging in. A public
 * gallery and a name search used to lead this page; both were disclosure, and
 * both are gone. Aggregate counts are still shown, because they identify no one.
 */

/* ------------------------------------------------------------------ icons */
/*
 * A small stroked set, sized by the text around them. Emoji used to do this
 * job: they cannot inherit weight or colour, they render differently on every
 * platform, and the flag emoji in this file once shipped to production as the
 * letters "IN" on Windows.
 */
const Icon = {
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
  camera: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" />
    </svg>
  ),
  register: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ utils */

/**
 * A translated sentence with markup inside it. The dictionary entry keeps
 * {name} placeholders where a link or a bold number goes, so each language can
 * put them where its own word order needs them: Gujarati, Hindi and Marathi put
 * the verb last, which a sentence cut into English-ordered fragments cannot do.
 */
function rich(text, parts) {
  return text.split(/\{(\w+)\}/g).map((piece, i) =>
    i % 2 ? <Fragment key={i}>{parts[piece] ?? `{${piece}}`}</Fragment> : piece,
  );
}

const AARAKSHAK_URL = 'https://aarakshak.com/';

/* -------------------------------------------------------------------- nav */

function Nav() {
  const t = useT();
  const { user } = useAuth();
  return (
    <header className="border-b border-black/5 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Logo />
        {/* No link to a list of missing people: the public is never shown one. */}
        <div className="hidden items-center gap-7 text-sm font-medium text-gray-600 md:flex">
          <Link to="/report" className="hover:text-ink">{t('Report a sighting')}</Link>
          <Link to="/track-case" className="hover:text-ink">{t('Track a case')}</Link>
          <Link to="/services" className="hover:text-ink">{t('Find help')}</Link>
        </div>
        {/* Beside the log-in link, so the language picker shows at every width. */}
        <div className="flex min-w-0 items-center gap-3">
          <LanguageSwitcher className="shrink-0" />
          {user ? (
            <Link to="/app" className="btn-primary">{t('Dashboard')}</Link>
          ) : (
            // Allowed to wrap: a longer translated label must not push a phone-width page sideways.
            <Link to="/login" className="inline-flex min-h-11 items-center text-right text-sm font-semibold leading-tight text-khozo hover:underline sm:whitespace-nowrap">
              {t('Officer log in')}
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------- hero */

/*
 * Sighting-first. The one large action sends a photograph; there is no search
 * box, because searching a name is disclosure. The eyebrow is an aggregate count
 * of open cases, which identifies no one; until it loads, or if it is zero, the
 * eyebrow simply names the action.
 *
 * The emergency numbers sit beside the action rather than at the foot of the
 * page: someone looking at a child in danger right now needs 1098 or 112 before
 * they need Khozo.
 */
function Hero({ openCases }) {
  const t = useT();
  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-12 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center lg:gap-16">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-khozo">
            {openCases ? t('Open missing-person cases · {n}', { n: openCases }) : t('Report a sighting')}
          </p>
          <h1 className="mt-3 text-[2.4rem] font-extrabold leading-[1.08] tracking-tight text-ink sm:text-6xl">
            {t('Seen a child, woman or person who seems lost?')}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
            {t('Send a photo — free, no login. Khozo never shows you who they are; a police officer checks every report.')}
          </p>
          {/* Utilities rather than .btn-primary: that class is unlayered CSS and would override the larger size. */}
          <Link
            to="/report"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-khozo px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-khozo-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-khozo focus-visible:ring-offset-2"
          >
            <Icon.camera className="h-5 w-5" /> {t('Send a photo')}
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 text-sm sm:mt-5">
            <Link to="/track-sighting" className="inline-flex min-h-11 items-center font-medium text-gray-600 hover:text-ink">{t('Track a report I made')}</Link>
            <Link to="/register" className="inline-flex min-h-11 items-center font-medium text-gray-600 hover:text-ink">{t('My child is missing')}</Link>
          </div>
        </div>

        <aside className="rounded-2xl border border-black/5 bg-gray-50 p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">{t('Immediate danger')}</p>
          <p className="mt-2 text-gray-700">
            {rich(t('If a child appears to be in immediate danger, call {childline} or {police} first.'), {
              childline: <strong className="text-ink">1098</strong>,
              police: <strong className="text-ink">112</strong>,
            })}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[['1098', msg('Childline')], ['112', msg('Police emergency')]].map(([number, label]) => (
              <a
                key={number}
                href={`tel:${number}`}
                className="flex flex-col items-center rounded-xl bg-white px-3 py-3 text-center ring-1 ring-black/10 transition hover:ring-red-300"
              >
                <span className="text-2xl font-extrabold leading-none text-ink">{number}</span>
                <span className="mt-1 text-xs font-medium text-gray-500">{t(label)}</span>
              </a>
            ))}
          </div>
          <p className="mt-4 text-sm text-gray-500">{t('Khozo does not replace an emergency call.')}</p>
        </aside>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- how / trust */

/*
 * The whole pipeline on one screen, for an officer as much as for a citizen:
 * the two ways a face comes in, the two engines that must agree, and the desk
 * that acts. Each line is held to the code. Aarakshak ranks the open cases,
 * the sighting's own district first (shared/match-pool.js); Rekognition must
 * confirm a candidate or it is withheld (addSecondOpinion in
 * worker/src/match.js). A department's register goes in through the same API
 * the Register FIR form uses (scripts/import-gujarat-cases.mjs). Other portals
 * arrive as exports; a live connection to them is marked as next, because it
 * is not built yet.
 */
const SOURCES = [
  {
    icon: Icon.camera,
    title: msg('Photos from the street'),
    lines: [msg('Citizens, and police on patrol, send a photo from a phone. Its location goes with it, and the sender gets a receipt to track it.')],
  },
  {
    icon: Icon.register,
    title: msg('Registered cases'),
    lines: [
      msg('Police stations, parents and NGOs register a missing person with a photograph.'),
      msg('A police department’s whole register is imported in bulk.'),
      msg('Exports from TrackChild, Khoya-Paya and other government or NGO portals are imported.'),
    ],
    next: msg('Direct live connections to those portals, as each one grants API access.'),
  },
];

// Engine names stay in Latin script in every language, so they are not wrapped.
const ENGINES = [
  {
    tag: msg('Proposes'),
    name: 'Aarakshak',
    body: msg('The Indian engine compares the face with open cases, the same district first, and proposes candidates.'),
  },
];

const DESK = [
  {
    tag: msg('Alerted'),
    name: msg('Police station and child-welfare desk'),
    body: msg('The desks for that area receive the match and its location.'),
  },
  {
    tag: msg('Verifies'),
    name: msg('An officer, in person'),
    body: msg('A score is never a decision. No family is contacted until an officer confirms.'),
  },
];

/** One numbered stage, joined to the next by a rail on the left. */
function Stage({ n, title, last, children }) {
  return (
    <li className={`relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 sm:gap-x-6 ${last ? '' : 'pb-10'}`}>
      {last ? null : (
        <span aria-hidden="true" className="absolute bottom-1 left-[1.125rem] top-11 w-0.5 -translate-x-1/2 rounded-full bg-khozo/25" />
      )}
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-khozo-light font-mono text-sm font-bold text-khozo-dark ring-1 ring-khozo/30">
        {String(n).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <h3 className="pt-1 text-lg font-bold leading-snug text-ink">{title}</h3>
        <div className="mt-4">{children}</div>
      </div>
    </li>
  );
}

/** Two boxes in order, with an arrow between: across on a wide screen, down on a phone. */
function Flow({ items }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
      {items.map((it, i) => (
        <Fragment key={it.tag}>
          {i ? (
            <Icon.arrow aria-hidden="true" className="h-5 w-5 shrink-0 rotate-90 self-center text-khozo sm:rotate-0" />
          ) : null}
          <div className="min-w-0 flex-1 rounded-2xl border border-black/5 bg-gray-50 p-4 sm:p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-khozo-dark">{t(it.tag)}</p>
            <p className="mt-1 font-bold text-ink">{t(it.name)}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{t(it.body)}</p>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function How() {
  const t = useT();
  return (
    <section id="how" className="border-y border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('How Khozo works')}</h2>
          <p className="mt-3 text-gray-600">
            {t('Two ways in, face matching, and a local officer who decides.')}
          </p>
        </div>
        <ol className="mt-10">
          <Stage n={1} title={t('Photographs come in two ways')}>
            <div className="grid gap-4 md:grid-cols-2">
              {SOURCES.map(({ icon: Ico, title, lines, next }) => (
                <div key={title} className="rounded-2xl border border-black/5 bg-gray-50 p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <Ico className="h-6 w-6 shrink-0 text-khozo" />
                    <h4 className="font-bold text-ink">{t(title)}</h4>
                  </div>
                  {lines.length === 1 ? (
                    <p className="mt-3 text-gray-600">{t(lines[0])}</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-gray-600">
                      {lines.map((line) => (
                        <li key={line} className="flex gap-2.5">
                          <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-khozo" />
                          <span>{t(line)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {next ? (
                    <p className="mt-4 border-t border-black/5 pt-3 text-sm text-gray-500">
                      <span className="mr-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-800">
                        {t('Coming next')}
                      </span>
                      {t(next)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </Stage>
          <Stage n={2} title={t('Face matching')}>
            <Flow items={ENGINES} />
            {/* The platform rule, stated as what it is: a feature. */}
            <p className="mt-4 flex items-start gap-3 rounded-2xl bg-khozo-light/60 p-4 text-sm leading-relaxed text-ink ring-1 ring-khozo/20">
              <Icon.shield className="mt-0.5 h-5 w-5 shrink-0 text-khozo-dark" />
              <span>
                <strong>{t('No public gallery of children.')}</strong>{' '}
                {t('Faces are compared by the engines, and only authorised officers see who matched.')}
              </span>
            </p>
          </Stage>
          <Stage n={3} title={t('The local desk is alerted')} last>
            <Flow items={DESK} />
          </Stage>
        </ol>
      </div>
    </section>
  );
}

/*
 * The safeguards were real and entirely invisible to the public. Someone being
 * asked to upload a photograph of a child is owed this before they are asked,
 * not in a policy page they will never open. Said once each: that nothing
 * identifying is shown to the public, that a score is never a decision, and
 * that a single engine's candidate is withheld are all in How above; the
 * emergency numbers are in the hero. Access follows shared/scope.js.
 */
const TRUST = [
  {
    icon: Icon.shield,
    title: msg('Seen only by those responsible'),
    body: msg('A district desk sees its own district’s cases, and a state desk its state’s. A parent or NGO sees only what they reported.'),
  },
  {
    icon: Icon.pin,
    title: msg('An auditable record'),
    body: msg('Every action on a case — who looked, who confirmed, when a family was contacted — is written to a tamper-evident audit chain the Department can verify later.'),
  },
];

function Trust() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {t('What happens to a child’s photograph')}
        </h2>
        <p className="mt-3 text-gray-600">
          {t('Khozo handles biometric data about children. These are the rules it holds itself to, and they are enforced in the software rather than promised in a policy.')}
        </p>
      </div>
      <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {TRUST.map(({ icon: Ico, title, body }) => (
          <div key={title}>
            <Ico className="h-6 w-6 text-khozo" />
            <h3 className="mt-3 font-bold text-ink">{t(title)}</h3>
            <p className="mt-1.5 text-gray-600">{t(body)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- sovereignty */

/*
 * Sovereign AI, stated plainly and only where it is true.
 *
 * Every claim here was checked against the running code before it was written:
 * the primary engine is Aarakshak (worker/src/match.js), the confirming engine
 * is AWS Rekognition pinned to ap-south-1 (worker/src/rekognition.js), and a
 * candidate really is withheld unless both agree. Rekognition is named, and
 * marked demo-only, because it is not Aarakshak and will not be in production;
 * leaving it unnamed let "two engines" read as all-Indian.
 *
 * A parent handing over a photograph of their child is owed a straight answer
 * about where it goes, and a claim on this page the code did not support would
 * be worse than saying nothing at all.
 */
function Sovereignty() {
  const t = useT();
  return (
    <section id="sovereign" className="bg-ink text-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">{t('Sovereign AI')}</p>
            <h2 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
              {t('A child’s face never leaves India.')}
            </h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-white/70">
              {t('Biometric matching for missing children runs on Aarakshak, an Indian provider, on Indian infrastructure. Nothing about a child is shipped abroad to be compared.')}
            </p>
            <a
              href={AARAKSHAK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-lime-300 hover:underline sm:mt-6"
            >
              {t('About Aarakshak')} <Icon.arrow className="h-4 w-4" />
            </a>
          </div>

          <dl className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2">
            <div className="bg-ink p-6">
              <dt className="text-sm font-bold text-lime-300">{t('Indian recognition engine')}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                {rich(t('Face comparison is performed by {aarakshak}, an Indian sovereign face-recognition model, under Government authorisation.'), {
                  aarakshak: (
                    <a
                      href={AARAKSHAK_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-white underline underline-offset-2 hover:text-lime-300"
                    >
                      Aarakshak
                    </a>
                  ),
                })}
              </dd>
            </div>
            <div className="bg-ink p-6">
              <dt className="text-sm font-bold text-lime-300">{t('AWS Rekognition — demo only')}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                {rich(t('This demo also uses AWS Rekognition as the confirming engine, pinned to the Mumbai {region} region. It will not be used in production, where matching runs on Aarakshak alone.'), {
                  region: <span className="font-mono text-white">ap-south-1</span>,
                })}
              </dd>
            </div>
            {/* Two engines agreeing is shown once, as stage 2 of How. */}
            <div className="bg-ink p-6 sm:col-span-2">
              <dt className="text-sm font-bold text-lime-300">{t('Records stay with the State')}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">
                {t('Cases, photographs and the audit trail remain in the Department’s own database, on Indian infrastructure, under its jurisdiction.')}
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
  [msg('Police & SJPU'), msg('Register FIRs, review citizen sightings, confirm a match and alert the family — with every action written to a tamper-evident record.')],
  [msg('CWC, DCPU & CCIs'), msg('Native roles for the child-protection desks the Juvenile Justice Act actually names, with production-compliance and care registers.')],
  [msg('State & national oversight'), msg('Caseload, reunification and coverage by district, so gaps are visible before a pilot begins rather than after it fails.')],
];

function ForAgencies() {
  const t = useT();
  return (
    <section id="agencies" className="border-y border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('Built for the desks that act')}</h2>
          <p className="mt-3 text-gray-600">
            {t('Khozo is one workflow from a citizen’s photograph to a restored child — report, verify, match, refer, restore — not a police tool with welfare bolted on.')}
          </p>
        </div>
        <dl className="mt-10 grid gap-8 sm:grid-cols-3">
          {AUDIENCES.map(([title, body]) => (
            <div key={title}>
              <dt className="font-bold text-ink">{t(title)}</dt>
              <dd className="mt-1.5 text-gray-600">{t(body)}</dd>
            </div>
          ))}
        </dl>
        <Link to="/register" className="btn-primary mt-10 inline-flex">{t('Request access for your agency')}</Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- origins */

function Origins() {
  const t = useT();
  return (
    <section id="origins" className="mx-auto max-w-6xl px-5 py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
        <div>
          <p className="font-mono text-5xl font-semibold leading-none text-khozo sm:text-6xl">2018</p>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-khozo-dark">{t('Where Khozo began')}</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {t('Data Science for Social Good')}
          </h2>
          <p className="mt-3 text-gray-600">
            {rich(t('Project Khozo was introduced as a Data Science for Social Good CSR initiative at the {congress} in Mumbai. The Congress was inaugurated by {minister}, then Union Minister of State for Parliamentary Affairs and for Statistics and Programme Implementation.'), {
              congress: <span className="font-semibold text-ink">{t('Data Science Congress 2018')}</span>,
              minister: <span className="font-semibold text-ink">{t('Shri Vijay Goel')}</span>,
            })}
          </p>
        </div>
        <img
          src="/assets/dsc-2018-vijay-goel.jpg"
          alt={t('Shri Vijay Goel, Minister of State for Parliamentary Affairs and Statistics and Programme Implementation, speaking at the Data Science Congress 2018 in Mumbai')}
          width="1600"
          height="837"
          loading="lazy"
          className="h-auto w-full rounded-2xl shadow-sm ring-1 ring-black/5"
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------- ministry + the app */

/*
 * Hidden, not removed: the band is kept so it can return for a Department
 * presentation by flipping this flag. The portrait it uses stays in
 * web/public/assets for the same reason.
 */
const SHOW_PROPOSED_TO = false;

/*
 * The sovereignty answer, lifted to the top of the page. The full section
 * (#sovereign) sits below the fold; someone about to hand over a photograph of
 * a child should not have to scroll to learn it stays in India. Worded to the
 * same claims Sovereignty() checks against the code.
 */
function SovereignBand() {
  const t = useT();
  return (
    <section className="border-b border-black/5 bg-ink text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:gap-7">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lime-300/15 ring-1 ring-lime-300/30">
          <Icon.shield className="h-6 w-6 text-lime-300" />
        </span>
        <div className="flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-lime-300">
            {t('Sovereign AI · Made in India')}
          </p>
          <h2 className="mt-1 text-lg font-bold leading-snug">
            {rich(t('Powered by {aarakshak}, India’s sovereign AI platform.'), {
              aarakshak: (
                <a
                  href={AARAKSHAK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-lime-300/60 underline-offset-4 hover:text-lime-300"
                >
                  Aarakshak
                </a>
              ),
            })}
          </h2>
          <p className="mt-1 text-sm text-white/70">
            {t('A child’s face is matched on Indian infrastructure — no photograph is sent beyond India’s borders to be compared.')}
          </p>
          <p className="mt-1 text-xs text-white/50">
            {t('This demo also uses AWS Rekognition (Mumbai region) as a second check. It will not be used in production.')}
          </p>
        </div>
        <a
          href="#sovereign"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-semibold text-lime-300 hover:underline"
        >
          {t('How we keep it in India')} <Icon.arrow className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}

function ProposedTo() {
  const t = useT();
  const [showPortrait, setShowPortrait] = useState(true);
  return (
    <section className="border-b border-black/5 bg-khozo-light/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:gap-7">
        {showPortrait ? (
          <img
            src="/assets/minister-wcd-maharashtra.jpg"
            alt={t('Hon’ble Smt. Aditi Sunil Tatkare, Cabinet Minister, Department of Women and Child Development, Government of Maharashtra')}
            onError={() => setShowPortrait(false)}
            className="h-24 w-24 shrink-0 rounded-2xl object-cover ring-1 ring-lime-200"
          />
        ) : null}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-khozo-dark">
            {t('Presented to')}
          </p>
          <h2 className="mt-1 text-lg font-bold leading-snug text-ink">
            {t('Department of Women and Child Development, Government of Maharashtra')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {rich(t('{minister}, Cabinet Minister, Women and Child Development — aligned to Mission Vatsalya.'), {
              minister: <span className="font-semibold text-ink">{t('Hon’ble Smt. Aditi Sunil Tatkare')}</span>,
            })}
          </p>
        </div>
      </div>
    </section>
  );
}

/*
 * The website is the app: it installs to the home screen from the browser,
 * opens full screen, and keeps a report made without signal until the signal
 * returns. Citizens, parents and officers use the same one. The separate
 * Android build stays available as a quiet link for anyone who prefers it.
 */
function GetApp() {
  const t = useT();
  return (
    <section className="border-t border-black/5 bg-khozo-light/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-12">
        <div>
          <h2 className="text-xl font-bold text-ink">{t('Khozo on your phone')}</h2>
          <p className="mt-1.5 max-w-xl text-gray-600">
            {t('Add Khozo to your home screen from this website. It opens like an app, works on a weak signal, and a report made with no signal is sent when the signal returns. Nothing to download from an app store.')}
          </p>
          <p className="mt-2 max-w-xl text-sm text-gray-500">
            {t('In Chrome on Android: open the ⋮ menu and choose “Install app” or “Add to Home screen”. On iPhone: tap Share, then “Add to Home Screen”.')}
          </p>
          <p className="mt-2 max-w-xl text-sm text-gray-500">{t('Officers sign in to the same app on any phone.')}</p>
          <a
            href="https://github.com/swastikkumar-alt/khozo/releases/latest/download/app-release.apk"
            download
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-gray-500 underline underline-offset-2 hover:text-ink"
          >
            {t('Download the Android app')}
          </a>
        </div>
        <InstallPrompt className="w-full shrink-0 sm:max-w-sm" />
      </div>
    </section>
  );
}

function Footer() {
  const t = useT();
  return (
    <footer className="bg-ink text-gray-400">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo light />
          <p className="mt-4 max-w-sm text-sm">
            {rich(t('An initiative of {aegis} and {factory}, under AI for Social Good.'), {
              aegis: <span className="font-semibold text-white">Aegis School of Data Science &amp; AI</span>,
              factory: (
                <a
                  href="https://aiproductsfactory.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white underline hover:text-lime-300"
                >
                  AI Products factory
                </a>
              ),
            })}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 text-sm sm:gap-x-10 sm:gap-y-2">
          <Link to="/report" className="flex min-h-11 items-center hover:text-white sm:min-h-0">{t('Report a sighting')}</Link>
          <Link to="/track-case" className="flex min-h-11 items-center hover:text-white sm:min-h-0">{t('Track a case')}</Link>
          <Link to="/track-sighting" className="flex min-h-11 items-center hover:text-white sm:min-h-0">{t('Track a report')}</Link>
          <Link to="/services" className="flex min-h-11 items-center hover:text-white sm:min-h-0">{t('Find help nearby')}</Link>
          <Link to="/grievance" className="flex min-h-11 items-center hover:text-white sm:min-h-0">{t('Raise a grievance')}</Link>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs">
          khozo.org · © {new Date().getFullYear()} · {t('Emergency: call 1098 or 112')}
        </p>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------- page */

export default function Landing() {
  // Only the aggregate count is read. The page never requests a list of people.
  const [openCases, setOpenCases] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/reports/public/summary')
      .then((d) => {
        const n = Number(d?.summary?.activeCases);
        if (alive) setOpenCases(Number.isFinite(n) && n > 0 ? n : null);
      })
      .catch(() => alive && setOpenCases(null));
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <Hero openCases={openCases} />
      <SovereignBand />
      {SHOW_PROPOSED_TO ? <ProposedTo /> : null}
      <How />
      <Trust />
      <Sovereignty />
      <ForAgencies />
      <Origins />
      <GetApp />
      <Footer />
    </div>
  );
}
