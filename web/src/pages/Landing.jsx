import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Logo, SectionTitle } from '../components.jsx';
import { useAuth } from '../auth.jsx';

function Nav() {
  const { user } = useAuth();
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Logo light />
        <div className="hidden items-center gap-8 text-sm font-medium text-white/90 md:flex">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#stakeholders" className="hover:text-white">For agencies</a>
          <a href="#impact" className="hover:text-white">Impact</a>
          <Link to="/bulletins" className="hover:text-white">Bulletins</Link>
          <Link to="/services" className="hover:text-white">Services</Link>
          <Link to="/track-case" className="hover:text-white">Track case</Link>
          <Link to="/track-sighting" className="hover:text-white">Track sighting</Link>
          <a href="https://github.com/swastikkumar-alt/khozo/releases/latest/download/app-release.apk" download className="hover:text-white flex items-center gap-1">📲 Get App</a>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <Link to="/app" className="btn-primary">Go to dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="hidden text-sm font-semibold text-white hover:text-white/80 sm:block">
                Log in
              </Link>
              <Link to="/register" className="btn bg-white text-khozo-dark hover:bg-khozo-light">
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  const [summary, setSummary] = useState(null);

  // Real counts or none. A dash while the request is in flight is honest; a
  // placeholder number on a page about missing children is not.
  useEffect(() => {
    api.get('/reports/public/summary')
      .then((d) => setSummary(d.summary || null))
      .catch(() => setSummary(null));
  }, []);

  return (
    <section className="khozo-mesh relative overflow-hidden text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent,rgba(0,0,0,.35))]" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-24 pt-36 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1 text-xs font-semibold uppercase tracking-widest ring-1 ring-white/25">
            AI for Social Good · <a href="https://aiproductsfactory.com" target="_blank" rel="noopener noreferrer" title="Visit AI Products factory" className="hover:underline text-lime-200 font-bold transition-all">AI Products factory</a>
          </p>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Your 1 click,
            <br />
            <span className="text-lime-200">a missing child</span> can return home.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/85">
            Khozo unites citizens, NGOs, police and government on one platform. Spot a child, snap a
            photo, and our face-match search alerts the right police station and the parents — in
            real time.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link to="/report" className="btn bg-white px-6 py-3 text-base text-khozo-dark hover:bg-khozo-light">
              📸 I spotted a child
            </Link>
            <Link to="/bulletins" className="btn px-6 py-3 text-base text-white ring-1 ring-white/40 hover:bg-white/10">
              View public bulletins
            </Link>
            <Link to="/services" className="btn px-6 py-3 text-base text-white ring-1 ring-white/40 hover:bg-white/10">
              Find help nearby
            </Link>
            <Link to="/track-case" className="btn px-6 py-3 text-base text-white ring-1 ring-white/40 hover:bg-white/10">
              Track case status
            </Link>
            <Link to="/register" className="btn px-6 py-3 text-base text-white ring-1 ring-white/40 hover:bg-white/10">
              My child is missing
            </Link>
            <a href="https://github.com/swastikkumar-alt/khozo/releases/latest/download/app-release.apk" download className="btn px-6 py-3 text-base text-white bg-emerald-600 hover:bg-emerald-700 ring-1 ring-emerald-400/40">
              📲 Download Mobile App (APK)
            </a>
          </div>
          <p className="mt-5 text-sm text-white/70">
            Free Android app · Web portal · Hosted by Aegis Knowledge Trust
          </p>
          {/*
            The app is distributed outside the Play Store, so Android shows an
            "unknown source" warning. Saying so up front is the difference
            between an officer installing it and assuming it is unsafe.
          */}
          <p className="mt-2 text-xs text-white/50">
            Android 7.0 or newer. The app installs directly rather than through the Play Store,
            so Android will ask you to allow installs from your browser once.
          </p>
        </div>

        <div className="relative">
          <ProposedTo />
          <div className="rounded-3xl bg-white/10 p-3 shadow-2xl ring-1 ring-white/20 backdrop-blur">
            <div className="rounded-2xl bg-white p-5 text-ink">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500">Live national overview</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> realtime
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { k: 'Active cases', v: summary?.activeCases, c: 'text-red-600' },
                  { k: 'Reunited', v: summary?.reunited, c: 'text-emerald-600' },
                  { k: 'Public bulletins', v: summary?.publicBulletins, c: 'text-ink' },
                  { k: 'Sightings received', v: summary?.sightingsReceived, c: 'text-khozo' },
                ].map((s) => (
                  <div key={s.k} className="rounded-xl bg-gray-50 p-4">
                    <p className="text-xs font-medium text-gray-500">{s.k}</p>
                    <p className={`mt-1 text-2xl font-bold ${s.c}`}>
                      {s.v == null ? <span className="text-gray-300">—</span> : s.v.toLocaleString('en-IN')}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-xl bg-khozo-light p-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-khozo text-white">✓</span>
                <div className="text-sm">
                  <p className="font-semibold">
                    {summary
                      ? `${summary.sightingsActioned.toLocaleString('en-IN')} sightings actioned by officers`
                      : 'Connecting to the Khozo network…'}
                  </p>
                  <p className="text-gray-500">
                    {summary
                      ? `${summary.statesCovered} state${summary.statesCovered === 1 ? '' : 's'} · ${summary.agenciesOnboard} agencies on the network`
                      : 'Live counts load from the national register'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: '01', t: 'Capture / upload', d: 'A citizen, NGO or officer captures the child’s photo on the Khozo app or website.', icon: '📷' },
  { n: '02', t: 'Secured in the cloud', d: 'The photo is stored securely in the centralized Khozo database alongside the FIR record.', icon: '🔒' },
  { n: '03', t: 'Face-match search', d: 'Our algorithm analyses the image and returns the best match against missing-person records.', icon: '🧠' },
  { n: '04', t: 'Alert & reunite', d: 'The nearest police station and the parents are notified by SMS / app pop-up. The child returns home.', icon: '🏠' },
];

function How() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-6 py-24">
      <SectionTitle kicker="Workflow" title="From a single click to a safe return">
        The same four steps from the field to the family — designed for speed and accuracy.
      </SectionTitle>
      <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.n} className="card relative p-6">
            <div className="text-3xl">{s.icon}</div>
            <p className="mt-4 text-sm font-bold text-khozo">{s.n}</p>
            <h3 className="mt-1 text-lg font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm text-gray-500">{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/*
 * Who this is being proposed to.
 *
 * The closing disclaimer is load-bearing and must not be dropped: Khozo is a
 * prototype offered to the Department for consideration, and no pilot has been
 * approved. A Minister's name and photograph on a live public page would
 * otherwise read as the Department having adopted the platform, which is a
 * claim we cannot make on her behalf. The heading kicker was removed at the
 * team's request; the disclaimer sentence is what keeps the band truthful, so
 * it stays.
 *
 * The portrait is optional by design. If docs hand over an image it renders;
 * if the file is absent the band still stands on the text, because a broken
 * image icon next to a Minister's name is worse than no photograph.
 */
function ProposedTo() {
  const [showPortrait, setShowPortrait] = useState(true);
  return (
    <div className="mb-4 rounded-3xl bg-white/95 p-4 shadow-2xl ring-1 ring-white/30 backdrop-blur">
      <div className="flex items-center gap-4">
        {showPortrait ? (
          <img
            src="/assets/minister-wcd-maharashtra.jpg"
            alt="Hon'ble Smt. Aditi Sunil Tatkare, Cabinet Minister, Department of Women and Child Development, Government of Maharashtra"
            onError={() => setShowPortrait(false)}
            className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-1 ring-lime-200"
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-sm font-bold leading-snug text-ink">
            Hon&rsquo;ble Smt. Aditi Sunil Tatkare
          </p>
          <p className="mt-0.5 text-xs font-medium text-khozo">
            Cabinet Minister, Women and Child Development
          </p>
          <p className="mt-1 text-xs leading-snug text-gray-500">
            Department of Women and Child Development, Government of Maharashtra — aligned to
            Mission Vatsalya.
          </p>
        </div>
      </div>
      {/* Kept even at this size. The band exists to name the Department, and the
          moment a Minister's photograph sits on a public page the disclaimer is
          the only thing separating "proposed to" from "endorsed by". */}
      <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-snug text-gray-400">
        Khozo is a working prototype offered in the spirit of public service by the Aegis School of
        Data Science &amp; AI, presented for the Department&rsquo;s direction on a supervised
        district pilot. It is not a Government-endorsed or Government-operated platform.
      </p>
    </div>
  );
}

/*
 * Where a child's face is actually compared, said plainly on the public page.
 *
 * Every claim here is checked against the code rather than aspirational:
 * the primary engine is Aarakshak (worker/src/match.js), the confirming engine
 * is pinned to ap-south-1 — AWS Mumbai (worker/src/rekognition.js), and a
 * candidate genuinely is withheld unless both engines agree. A parent handing
 * over a photograph of their child is owed a straight answer about where it
 * goes, and a claim on this page that the code did not support would be worse
 * than saying nothing.
 */
function Sovereignty() {
  return (
    <section id="sovereignty" className="bg-lime-50/60 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionTitle kicker="Data sovereignty" title="A child's face never leaves India">
          Biometric matching for missing children is run on Indian infrastructure, by an Indian
          provider — not shipped abroad for processing.
        </SectionTitle>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <div className="card p-6">
            {/* Not a 🇮🇳 flag emoji: Windows ships no regional-indicator glyphs,
                so every Chrome-on-Windows visitor would see the letters "IN". */}
            <div className="text-3xl">🛡️</div>
            <h3 className="mt-4 text-lg font-semibold">Indian face-recognition engine</h3>
            <p className="mt-2 text-sm text-gray-500">
              Face matching is performed by{' '}
              <a
                href="https://aarakshak.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-khozo underline hover:text-khozo-dark"
              >
                Aarakshak
              </a>
              , an Indian face-recognition provider, under Government authorisation.
            </p>
          </div>
          <div className="card p-6">
            <div className="text-3xl">📍</div>
            <h3 className="mt-4 text-lg font-semibold">Processed in Mumbai</h3>
            <p className="mt-2 text-sm text-gray-500">
              The confirming engine is pinned to the <span className="font-semibold">ap-south-1</span>{' '}
              (Mumbai) region. Children&rsquo;s photographs are not sent to overseas regions for
              comparison.
            </p>
          </div>
          <div className="card p-6">
            <div className="text-3xl">🤝</div>
            <h3 className="mt-4 text-lg font-semibold">Two engines must agree</h3>
            <p className="mt-2 text-sm text-gray-500">
              One engine proposing a face is a lead, not a match. A candidate is shown to an officer
              only when a second, independent engine confirms it — otherwise it is withheld.
            </p>
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-gray-500">
          Photographs are stored against the case record, never on a public screen: guardian
          contacts, identity numbers, exact addresses and protected photographs stay redacted.
        </p>
      </div>
    </section>
  );
}

const AUDIENCES = [
  {
    tag: 'Government of India',
    t: 'A national command centre',
    d: 'NCRB-grade oversight across every state. Track missing & reunited figures, drill into any state, district or station, and broadcast directives.',
    points: ['Nationwide dashboard & analytics', 'State-wise drill-down', 'Policy & welfare-scheme integration'],
    accent: 'from-blue-600 to-blue-800',
  },
  {
    tag: 'State Governments',
    t: 'Coordinate your state',
    d: 'Equip your police and welfare departments. Monitor jurisdiction caseloads and reunification rates, and rally NGOs and citizens.',
    points: ['State & district views', 'NGO & citizen mobilization', 'Media / TV / radio campaign hooks'],
    accent: 'from-khozo to-khozo-dark',
  },
  {
    tag: 'Police Department',
    t: 'Faster FIRs, faster matches',
    d: 'A hierarchical dashboard — Commissioner → ACP → Station. Register FIRs, review citizen sightings, confirm matches and alert parents in clicks.',
    points: ['Register & manage FIRs', 'Review face-match candidates', 'One-click SMS to parents'],
    accent: 'from-slate-700 to-slate-900',
  },
  {
    tag: 'Prospective partners',
    t: 'NGOs, CSR & citizens',
    d: 'A free public good. NGOs and citizens report sightings; CSR and partners help publicize the app through welfare channels and media.',
    points: ['Free Android / iOS apps', 'Citizen sighting reports', 'CSR & celebrity endorsement ready'],
    accent: 'from-amber-500 to-orange-600',
  },
];

function Stakeholders() {
  return (
    <section id="stakeholders" className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionTitle kicker="For every stakeholder" title="One platform, every level of the chain">
          Khozo is built for the people who can act — from a citizen on the street to the
          Government of India.
        </SectionTitle>
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {AUDIENCES.map((a) => (
            <div key={a.tag} className="card overflow-hidden">
              <div className={`bg-gradient-to-r ${a.accent} px-6 py-5 text-white`}>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/80">{a.tag}</p>
                <h3 className="mt-1 text-xl font-bold">{a.t}</h3>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600">{a.d}</p>
                <ul className="mt-4 space-y-2">
                  {a.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="text-khozo">✓</span> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pyramid() {
  const layers = [
    { t: 'Super Admin', d: 'Govt of India · State Govt · Police Commissioner — full national view', w: 'w-full' },
    { t: 'Admin', d: 'Asst. Commissioner of Police — jurisdiction view & drill-down', w: 'w-4/5' },
    { t: 'User (Police Station)', d: 'Registers FIRs, confirms matches, alerts parents', w: 'w-3/5' },
    { t: 'Public · Parents · NGOs', d: 'Capture & upload child photos, register missing children', w: 'w-2/5' },
  ];
  return (
    <section id="impact" className="mx-auto max-w-7xl px-6 py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionTitle title="A clear chain of access" />
          <p className="mt-4 text-gray-500">
            Every role sees exactly what it should. Higher tiers drill down into the tiers below and
            can reach out by email or WhatsApp straight from the dashboard.
          </p>
          <Link to="/register" className="btn-primary mt-6">Request access for your agency →</Link>
        </div>
        <div className="flex flex-col items-center gap-3">
          {layers.map((l, i) => (
            <div
              key={l.t}
              className={`${l.w} rounded-2xl px-6 py-4 text-center text-white shadow-md`}
              style={{ background: `hsl(88 55% ${28 + i * 9}%)` }}
            >
              <p className="font-bold">{l.t}</p>
              <p className="text-xs text-white/85">{l.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="khozo-gradient">
      <div className="mx-auto max-w-4xl px-6 py-20 text-center text-white">
        <h2 className="text-3xl font-bold sm:text-4xl">Bring Khozo to your state or department</h2>
        <p className="mx-auto mt-4 max-w-2xl text-white/85">
          Thousands of children go missing every year. With one click, your agency can help them
          return home. Let’s deploy Khozo together.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link to="/register" className="btn bg-white px-6 py-3 text-base text-khozo-dark hover:bg-khozo-light">
            Get started
          </Link>
          <a href="https://github.com/swastikkumar-alt/khozo/releases/latest/download/app-release.apk" download className="btn px-6 py-3 text-base text-white bg-emerald-600 hover:bg-emerald-700 ring-1 ring-emerald-400/40">
            📲 Download Android App
          </a>
          <a href="mailto:partnerships@khozo.org" className="btn px-6 py-3 text-base text-white ring-1 ring-white/40 hover:bg-white/10">
            Talk to partnerships
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-gray-400">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
        <Logo light />
        <p className="max-w-md text-sm sm:text-center">An initiative of <span className="font-semibold text-white">Aegis School of Data Science &amp; AI</span> and <a href="https://aiproductsfactory.com" target="_blank" rel="noopener noreferrer" title="Visit AI Products factory website" className="font-semibold text-white underline hover:text-lime-300 transition-colors">AI Products factory</a>, under AI for Social Good.</p>
        <p className="text-sm">khozo.org · © {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div>
      <Nav />
      <Hero />
      <How />
      <Sovereignty />
      <Stakeholders />
      <Pyramid />
      <CTA />
      <Footer />
    </div>
  );
}
