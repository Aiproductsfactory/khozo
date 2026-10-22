import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useT, msg } from '../i18n.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import { EmergencyCalls, PublicFooter, PublicHeader, PublicIcon as Icon, ShareKhozo, usePageMeta } from '../PublicChrome.jsx';

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
 *
 * Read top to bottom, the page answers the questions in the order a visitor
 * has them: what do I do (send a photo, or call 112 now), which of these is me
 * (the four paths), what happens to my photo, what do I do if it is my own
 * family, how do I tell others, and only then who built it and for whom.
 */

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

/** A small uppercase label above a heading. */
function Kicker({ children, className = 'text-khozo-dark' }) {
  return <p className={`text-xs font-bold uppercase tracking-[0.16em] ${className}`}>{children}</p>;
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
 * they need Khozo. The three promises under the button are the three things a
 * stranger wants to know before handing over a photograph of a child.
 */
const PROMISES = [
  msg('Free, and no login or app needed'),
  msg('A police officer checks every report before anyone is contacted'),
  msg('Matched in India by Aarakshak, and never shown to the public'),
];

function Hero({ openCases, ctaRef }) {
  const t = useT();
  return (
    <section className="bg-white">
      {/* On a phone the emergency numbers come straight after the button,
          before the promises; on a wide screen they sit beside both. */}
      <div className="mx-auto grid max-w-6xl gap-y-8 px-5 pb-14 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:pb-20">
        <div className="max-w-2xl">
          <Kicker className="text-khozo">
            {openCases ? t('Open missing-person cases · {n}', { n: openCases }) : t('Report a sighting')}
          </Kicker>
          <h1 className="mt-3 text-balance text-[2.35rem] font-extrabold leading-[1.08] tracking-tight text-ink sm:text-6xl">
            {t('Seen a child, woman or person who seems lost?')}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
            {t('Send a photo — free, no login. Khozo never shows you who they are; a police officer checks every report.')}
          </p>
          <div ref={ctaRef} className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            {/* Utilities rather than .btn-primary: that class is unlayered CSS and would override the larger size. */}
            <Link
              to="/report"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-khozo px-6 py-3.5 text-base font-semibold text-white transition hover:bg-khozo-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-khozo focus-visible:ring-offset-2"
            >
              <Icon.camera className="h-5 w-5" /> {t('Send a photo')}
            </Link>
            <Link to="/track-sighting" className="inline-flex min-h-11 items-center justify-center font-medium text-gray-600 hover:text-ink sm:justify-start">
              {t('Track a report I made')}
            </Link>
          </div>
        </div>

        <aside className="self-start rounded-2xl bg-red-50/70 p-5 ring-1 ring-red-100 sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center" aria-labelledby="danger-title">
          <p id="danger-title" className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">{t('Immediate danger')}</p>
          <p className="mt-2 text-gray-800">
            {rich(t('If a child appears to be in immediate danger, call {childline} or {police} first.'), {
              childline: <strong className="text-ink">1098</strong>,
              police: <strong className="text-ink">112</strong>,
            })}
          </p>
          <EmergencyCalls className="mt-4" />
          <p className="mt-4 text-sm text-gray-500">{t('Khozo does not replace an emergency call.')}</p>
        </aside>

        <ul className="max-w-2xl space-y-2.5 border-t border-black/[0.06] pt-6 lg:col-start-1 lg:row-start-2">
          {PROMISES.map((p) => (
            <li key={p} className="flex gap-2.5 text-[15px] text-gray-700">
              <Icon.check className="mt-0.5 h-5 w-5 shrink-0 text-khozo" />
              <span>{t(p)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ paths */

/*
 * Four people arrive here, and each was left to find their own way: the
 * family of a missing child had one grey link, to an account form, with no
 * word on what to do first. Each path is said as the visitor would say it.
 */
const PATHS = [
  {
    href: '/report',
    title: msg('I saw someone who seems lost'),
    body: msg('Send a photo, or only a description and the place. It takes a minute.'),
    cta: msg('Send a report'),
    primary: true,
  },
  {
    href: '#families',
    title: msg('Someone in my family is missing'),
    body: msg('What to do in the first hours, and how to register them.'),
    cta: msg('See what to do'),
  },
  {
    href: '/track-sighting',
    title: msg('I sent a report'),
    body: msg('Check what has happened to it with your receipt number.'),
    cta: msg('Track a report'),
  },
  {
    href: '/login',
    title: msg('I work for the police, a CWC or an NGO'),
    body: msg('Review sightings, check possible matches and manage cases.'),
    cta: msg('Officer log in'),
  },
];

function Paths() {
  const t = useT();
  return (
    <section aria-labelledby="paths-title" className="border-y border-black/[0.06] bg-[#f6f8f5]">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <h2 id="paths-title" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('How can Khozo help you?')}</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PATHS.map((p) => {
            const body = (
              <>
                <span className={`block text-lg font-bold leading-snug ${p.primary ? 'text-white' : 'text-ink'}`}>{t(p.title)}</span>
                <span className={`mt-2 block flex-1 ${p.primary ? 'text-white/85' : 'text-gray-600'}`}>{t(p.body)}</span>
                <span className={`mt-5 inline-flex items-center gap-1.5 text-sm font-semibold ${p.primary ? 'text-white' : 'text-khozo-dark'}`}>
                  {t(p.cta)} <Icon.arrow className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </>
            );
            const cls = `group flex h-full flex-col rounded-2xl p-5 transition ${
              p.primary ? 'bg-khozo hover:bg-khozo-dark' : 'bg-white ring-1 ring-black/[0.07] hover:ring-khozo/40'
            }`;
            return (
              <li key={p.href}>
                {p.href.startsWith('#') ? <a href={p.href} className={cls}>{body}</a> : <Link to={p.href} className={cls}>{body}</Link>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- journey */

/*
 * What happens to a photograph, in the four steps a sender cares about. Each
 * is held to the code: the location picks the desk (shared/geocode.js);
 * Aarakshak ranks open cases, the sighting's own district first
 * (shared/match-pool.js); nothing is decided by a score; a traced woman or
 * adult is asked before their family is told. The sender is never shown the
 * result (pages/Capture.jsx gives everyone the same receipt).
 *
 * Drawn as the picture the feasibility report and the explainer film use: the
 * sender's step, then a shaded band for everything only authorised officials
 * see (police, and for a child the CWC and DCPU desks: shared/scope.js), then
 * what never happens to the photo. That boundary is what makes a stranger
 * willing to send one.
 */
const STEPS = [
  {
    icon: 'send',
    title: msg('You send a photo and the place'),
    body: msg('Your phone adds the location, so the desk for that area is told. You get a receipt number to track it.'),
  },
  {
    icon: 'compare',
    title: msg('It is compared in private'),
    body: msg('An Indian face-matching service compares the face with open cases, the same district first, and suggests possible matches.'),
  },
  {
    icon: 'verify',
    title: msg('An officer checks, in person'),
    body: msg('A score is never a decision. No family is contacted until an officer confirms.'),
  },
  {
    icon: 'home',
    title: msg('Home, safely'),
    body: msg('A child who is found is produced before the Child Welfare Committee. A woman or adult who is traced is asked first; their family is told only with their consent.'),
  },
];

const PRIVATE = [
  msg('It is never shared on WhatsApp or put in a public gallery.'),
  msg('Nobody but authorised officials sees it.'),
  msg('You are not told who the person is, to keep them safe.'),
  msg('It is not kept for ever: it is deleted after 180 days.'),
];

const stepStroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const STEP_ICONS = {
  send: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" {...stepStroke}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M12 16V8m-3 3 3-3 3 3" />
    </svg>
  ),
  compare: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" {...stepStroke}>
      <circle cx="7" cy="8.5" r="3" /><path d="M2.5 19a4.5 4.5 0 0 1 9 0" /><circle cx="17" cy="8.5" r="3" /><path d="M12.5 19a4.5 4.5 0 0 1 9 0" />
    </svg>
  ),
  verify: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" {...stepStroke}>
      <path d="M12 2.5 19.5 5.5v5.2c0 4.7-3.2 8.7-7.5 10.8-4.3-2.1-7.5-6.1-7.5-10.8V5.5z" /><path d="m8.5 12 2.4 2.4 4.6-4.8" />
    </svg>
  ),
  home: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" {...stepStroke}>
      <path d="M3 11 12 3.5 21 11" /><path d="M5.5 9.5V20.5h13V9.5" /><path d="M10 20.5v-6h4v6" />
    </svg>
  ),
};

function Step({ step, n, onTint = false }) {
  const t = useT();
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 md:block">
      <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-khozo text-white shadow-sm">
        {STEP_ICONS[step.icon]}
        <span className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ring-2 ${onTint ? 'bg-white text-khozo-dark ring-khozo-light' : 'bg-white text-khozo-dark ring-white'}`}>
          {n}
        </span>
      </span>
      <div className="md:mt-4">
        <h3 className="pt-1 font-bold leading-snug text-ink md:pt-0">{t(step.title)}</h3>
        <p className="mt-1.5 leading-relaxed text-gray-600">{t(step.body)}</p>
      </div>
    </li>
  );
}

function Journey() {
  const t = useT();
  const [first, ...rest] = STEPS;
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-16 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl">
          <Kicker>{t('How Khozo works')}</Kicker>
          <h2 id="how-title" className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('What happens after you send a photo')}</h2>
        </div>

        {/* Your step, then the band of what only authorised officials see. */}
        <div className="mt-10 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,3fr)] md:items-start md:gap-5">
          <ol className="md:pt-[3.75rem]">
            <Step step={first} n={1} />
          </ol>
          <span aria-hidden="true" className="flex justify-start pl-3 text-khozo/60 md:justify-center md:pl-0 md:pt-[4.3rem]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 rotate-90 md:rotate-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15m-5-5 5 5-5 5" /></svg>
          </span>
          <div className="rounded-2xl bg-khozo-light/70 p-5 ring-1 ring-khozo/20 sm:p-6">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-khozo-dark">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              {t('Only authorised officials see it from here')}
            </p>
            <ol start={2} className="mt-5 grid gap-7 md:grid-cols-3 md:gap-6">
              {rest.map((s, i) => <Step key={s.title} step={s} n={i + 2} onTint />)}
            </ol>
          </div>
        </div>

        {/* What never happens to the photo: the reason to trust the button. */}
        <div className="mt-10 rounded-2xl p-5 ring-1 ring-black/[0.07] sm:p-6">
          <h3 className="flex items-center gap-2 font-bold text-ink">
            <Icon.shield className="h-5 w-5 text-khozo-dark" />
            {t('Your photo stays private')}
          </h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRIVATE.map((line) => (
              <li key={line} className="flex gap-2.5 leading-relaxed text-gray-700">
                <Icon.check className="mt-1 h-4 w-4 shrink-0 text-khozo" />
                <span>{t(line)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- families */

/*
 * The family of a missing person, in their first hours. Only what Khozo can
 * stand behind: there is no waiting period before a missing person can be
 * reported; a parent or NGO account registers the case (CASE_CREATE_ROLES);
 * matching starts only once an officer has verified it (intake_pending); the
 * Case ID is what /track-case reads; and the service is free.
 */
const FAMILY_STEPS = [
  {
    title: msg('Call 112 or go to the nearest police station'),
    body: msg('You do not need to wait 24 hours. For a missing child, the police register an FIR. Take a recent photo and say what they were wearing.'),
  },
  {
    title: msg('Register them on Khozo'),
    body: msg('Create a free family account and add a clear, recent photo. An officer verifies the case before matching begins.'),
  },
  {
    title: msg('Keep your Case ID'),
    body: msg('Use it on Track my case to see progress. Only you and the officers on the case see the details.'),
  },
];

function Families() {
  const t = useT();
  return (
    <section id="families" aria-labelledby="families-title" className="scroll-mt-16 border-y border-black/[0.06] bg-[#f6f8f5]">
      {/* On a phone the steps come before the buttons: the first thing to do
          is call the police, not open an account. */}
      <div className="mx-auto grid max-w-6xl gap-y-8 px-5 py-16 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-16">
        <div>
          <Kicker>{t('For families')}</Kicker>
          <h2 id="families-title" className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('If someone in your family is missing')}</h2>
          <p className="mt-3 max-w-md text-gray-600">{t('Act now. Every hour matters, and these three steps work together.')}</p>
        </div>
        <ol className="space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {FAMILY_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-2xl bg-white p-5 ring-1 ring-black/[0.06]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-khozo text-sm font-bold text-white">{i + 1}</span>
              <div className="min-w-0">
                <h3 className="font-bold leading-snug text-ink">{t(s.title)}</h3>
                <p className="mt-1 leading-relaxed text-gray-600">{t(s.body)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="lg:col-start-1 lg:row-start-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link to="/register" className="btn-primary">{t('Create a free family account')}</Link>
            <Link to="/track-case" className="btn-ghost">{t('Track my case')}</Link>
          </div>
          <Link to="/services" className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-khozo-dark hover:underline">
            {t('Find help nearby')} <Icon.arrow className="h-4 w-4" />
          </Link>
          <p className="mt-6 flex max-w-md items-start gap-2.5 text-sm text-gray-600">
            <Icon.shield className="mt-0.5 h-5 w-5 shrink-0 text-khozo-dark" />
            <span>{t('Khozo is free. Nobody from Khozo will ever ask you for money.')}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- share */

function Share() {
  return (
    <section aria-labelledby="share-title" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <ShareKhozo />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ safeguards */

/*
 * Sovereign AI and the safeguards, stated once, plainly, and only where true.
 * They used to be said twice over — a dark band under the hero and a dark
 * section further down — with the access and audit rules in a third section
 * between them.
 *
 * Every claim here was checked against the running code before it was written:
 * the primary engine is Aarakshak (worker/src/match.js), the confirming engine
 * is AWS Rekognition pinned to ap-south-1 (worker/src/rekognition.js), and a
 * candidate really is withheld unless both agree. Rekognition is named, and
 * marked demo-only, because it is not Aarakshak and will not be in production;
 * leaving it unnamed let "two engines" read as all-Indian. Access follows
 * shared/scope.js; the audit chain is shared/audit-chain.js.
 *
 * A parent handing over a photograph of their child is owed a straight answer
 * about where it goes, and a claim on this page the code did not support would
 * be worse than saying nothing at all.
 */
function Safeguards() {
  const t = useT();
  const items = [
    {
      title: t('Indian face matching'),
      body: rich(t('Faces are compared by {aarakshak}, an Indian face-recognition service, with Government approval.'), {
        aarakshak: (
          <a href={AARAKSHAK_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline underline-offset-2 hover:text-lime-300">
            Aarakshak
          </a>
        ),
      }),
    },
    {
      title: t('AWS Rekognition — demo only'),
      body: rich(t('During the trial, AWS Rekognition gives a second check, kept to its Mumbai {region} region. It will not be used once Khozo is live, when Aarakshak alone compares faces.'), {
        region: <span className="font-mono text-white">ap-south-1</span>,
      }),
    },
    { title: t('Seen only by those responsible'), body: t('A district desk sees its own district’s cases, and a state desk its state’s. A parent or NGO sees only what they reported.') },
    { title: t('A record that can be checked'), body: t('Every action on a case — who looked, who confirmed, when a family was contacted — is written into a record that shows any change, which the Department can check later.') },
    { title: t('Records stay with the State'), body: t('Cases, photos and the record of actions stay in the Department’s own database, in India, under its control.') },
  ];
  return (
    <section id="sovereign" aria-labelledby="sovereign-title" className="scroll-mt-16 bg-ink text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:py-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <div>
          <Kicker className="text-lime-300">{t('Sovereign AI')}</Kicker>
          <h2 id="sovereign-title" className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
            {t('A child’s face never leaves India.')}
          </h2>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-white/70">
            {t('Face matching for missing children runs on Aarakshak, an Indian service, in India. Nothing about a child is sent abroad to be compared.')}
          </p>
          <p className="mt-4 max-w-md text-white/60">
            {t('Khozo handles children’s face data. These are the rules it keeps, and the software enforces them; they are not just promises in a policy.')}
          </p>
          <a href={AARAKSHAK_URL} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-lime-300 hover:underline">
            {t('About Aarakshak')} <Icon.arrow className="h-4 w-4" />
          </a>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2">
          {items.map((item, i) => (
            <div key={item.title} className={`bg-ink p-5 sm:p-6 ${i === items.length - 1 && items.length % 2 ? 'sm:col-span-2' : ''}`}>
              <dt className="text-sm font-bold text-lime-300">{item.title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-white/70">{item.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- for agencies */

const AUDIENCES = [
  [msg('Police & SJPU'), msg('Register FIRs, review citizen sightings, confirm a match and alert the family — with every action written into a record that shows any change.')],
  [msg('CWC, DCPU & CCIs'), msg('Screens for each child-protection office the Juvenile Justice Act names, with registers for production on time and for care.')],
  [msg('State & national oversight'), msg('Cases, children returned home and offices set up in each district, so gaps are seen before a pilot begins, not after it fails.')],
];

/*
 * How cases arrive, for the departments deciding whether to use Khozo. A
 * department's register goes in through the same API the Register FIR form
 * uses (scripts/import-gujarat-cases.mjs). Other portals arrive as exports; a
 * live connection to them is marked as next, because it is not built yet.
 */
const SOURCES = [
  msg('Police stations, parents and NGOs register a missing person with a photograph.'),
  msg('A police department’s whole register is imported in bulk.'),
  msg('Exports from TrackChild, Khoya-Paya and other government or NGO portals are imported.'),
];

function ForAgencies() {
  const t = useT();
  return (
    <section id="agencies" aria-labelledby="agencies-title" className="scroll-mt-16 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <div className="max-w-2xl">
          <Kicker>{t('For agencies')}</Kicker>
          <h2 id="agencies-title" className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('Built for the desks that act')}</h2>
          <p className="mt-3 text-gray-600">
            {t('Khozo takes a case from a citizen’s photo to a child safely home — report, check, match, refer, return — built for child welfare as much as for the police.')}
          </p>
        </div>
        <dl className="mt-10 grid gap-8 sm:grid-cols-3">
          {AUDIENCES.map(([title, body]) => (
            <div key={title} className="border-t border-black/10 pt-4">
              <dt className="font-bold text-ink">{t(title)}</dt>
              <dd className="mt-1.5 leading-relaxed text-gray-600">{t(body)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10 rounded-2xl bg-[#f6f8f5] p-5 ring-1 ring-black/[0.05] sm:p-6">
          <h3 className="font-bold text-ink">{t('Registered cases')}</h3>
          <ul className="mt-3 space-y-2 text-gray-600">
            {SOURCES.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-khozo" />
                <span>{t(line)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-black/5 pt-3 text-sm text-gray-500">
            <span className="mr-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-800">
              {t('Coming next')}
            </span>
            {t('Direct links to those portals, as each one gives permission.')}
          </p>
        </div>
        <Link to="/register" className="btn-primary mt-8 inline-flex">{t('Request access for your agency')}</Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- origins */

function Origins() {
  const t = useT();
  return (
    <section id="origins" aria-labelledby="origins-title" className="border-t border-black/[0.06] bg-[#f6f8f5]">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-14">
        <div>
          <Kicker>{t('Where Khozo began')} · 2018</Kicker>
          <h2 id="origins-title" className="mt-2 text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {t('Data Science for Social Good')}
          </h2>
          <p className="mt-3 leading-relaxed text-gray-600">
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
          decoding="async"
          className="h-auto w-full rounded-2xl ring-1 ring-black/5"
        />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- presented to */

/*
 * Hidden, not removed: the band is kept so it can return for a Department
 * presentation by flipping this flag. The portrait it uses stays in
 * web/public/assets for the same reason.
 */
const SHOW_PROPOSED_TO = false;

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

/* ---------------------------------------------------------------- the app */

/*
 * The website is the app: it installs to the home screen from the browser,
 * opens full screen, and keeps a report made without signal until the signal
 * returns. Citizens, parents and officers use the same one. The separate
 * Android build stays available as a quiet link for anyone who prefers it.
 */
function GetApp() {
  const t = useT();
  return (
    <section className="border-t border-black/[0.06] bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">{t('Khozo on your phone')}</h2>
          <p className="mt-1.5 max-w-xl text-gray-600">
            {t('Add Khozo to your home screen from this website. It opens like an app, works on a weak signal, and a report made with no signal is sent when the signal returns. Nothing to download from an app store.')}
          </p>
          <p className="mt-2 max-w-xl text-sm text-gray-500">
            {t('In Chrome on Android: open the ⋮ menu and choose “Install app” or “Add to Home screen”. On iPhone: tap Share, then “Add to Home Screen”.')}
          </p>
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

/* -------------------------------------------------------- phone shortcut */

/*
 * On a phone, once the hero's button has scrolled away, the one action stays
 * a thumb's reach from the bottom of the screen. It steps aside over the
 * footer, so it never covers the emergency numbers there.
 */
function StickyReport({ ctaRef, footerRef }) {
  const t = useT();
  const [pastHero, setPastHero] = useState(false);
  const [atFooter, setAtFooter] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const hero = new IntersectionObserver(([e]) => setPastHero(!e.isIntersecting && e.boundingClientRect.top < 0));
    const foot = new IntersectionObserver(([e]) => setAtFooter(e.isIntersecting));
    if (ctaRef.current) hero.observe(ctaRef.current);
    if (footerRef.current) foot.observe(footerRef.current);
    return () => { hero.disconnect(); foot.disconnect(); };
  }, [ctaRef, footerRef]);
  if (!pastHero || atFooter) return null;
  return (
    <div className="safe-bottom animate-rise fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 px-4 pt-3 backdrop-blur sm:hidden">
      <Link to="/report" className="btn-primary mb-3 w-full">
        <Icon.camera className="h-5 w-5 shrink-0" /> {t('Send a photo')}
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default function Landing() {
  usePageMeta({
    description: msg('Seen a child, woman or person who may be missing? Send a photo from your phone in under a minute — free, no login. A police officer checks every report before any family is contacted.'),
  });
  const { hash } = useLocation();
  const ctaRef = useRef(null);
  const footerRef = useRef(null);
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

  // /#families from another page's menu: the router changes the address but
  // does not scroll to the section, so this does.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [hash]);

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />
      <main>
        <Hero openCases={openCases} ctaRef={ctaRef} />
        {SHOW_PROPOSED_TO ? <ProposedTo /> : null}
        <Paths />
        <Journey />
        <Families />
        <Share />
        <Safeguards />
        <ForAgencies />
        <Origins />
        <GetApp />
      </main>
      <div ref={footerRef}>
        <PublicFooter />
      </div>
      <StickyReport ctaRef={ctaRef} footerRef={footerRef} />
    </div>
  );
}
