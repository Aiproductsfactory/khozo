import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { asList, CategoryBadge, coordsOf, isAdultCase, MapsLink, personCategoryOf, PhoneLink, ProtectedImage, StatusBadge, timeAgo, txt } from '../lib.jsx';
import { CONCERN_REASON_LABELS, DISMISSAL_OPTIONS } from '../sightingConcern.js';
import { useAuth } from '../auth.jsx';
import { ErrorBoundary } from '../components.jsx';
import { currentLocale, msg, t, useT } from '../i18n.jsx';
import { useDisplay } from '../useDisplay.js';
import { useBackClose } from '../useBackClose.js';
import { usePolling } from '../usePolling.js';
import { ActionMessage, ActionToast, useAction } from './useAction.jsx';
import { ConfirmMatchDialog, EngineScoreLine, EngineScores, MatchEvidence, currentCandidate, matchLinesOf, photoCheckFlag, telHref } from './Reunite.jsx';
import PhotoViewer from './PhotoViewer.jsx';
import { MAIN_PHOTO, photoUrlOf, viewPhotosOf } from '../../../shared/photo-set.js';

/**
 * Which photo of the sighting and which of the case a candidate's score is
 * for (shared/photo-set.js ids), so the comparison opens on that pair.
 */
function photoPairOf(sighting, matched) {
  const candidate = asList(sighting?.matchCandidates).find((c) => c && c.reportId === matched?.id);
  return candidate?.photoPair || (sighting?.matchedReportId === matched?.id ? sighting?.matchedPhotoPair : null) || null;
}
import { POLICE_ROLES } from '../../../shared/scope.js';
import { sightingScreenVerdict } from '../../../shared/face-screen.js';

// Who may search a sighting again (POST /reports/found/:id/rematch): police
// roles. Who may place a sighting in a district (POST /found/:id/place): the
// national desk, state desks and police, within their own state.
const SEARCH_AGAIN_ROLES = POLICE_ROLES;
const PLACEMENT_ROLES = ['super_admin', 'admin', 'state_nodal', 'sara', 'crime_bureau', ...POLICE_ROLES];

/** Whether a sighting's search can be run again: a photo, and not closed by an officer. */
function searchable(f) {
  return Boolean(txt(f.photoFile) || txt(f.photoUrl)) && !f.anonymizedAt && !['matched', 'rejected'].includes(f.status);
}

/** "Compared with 18 of 240 open cases", from the record of the last search. */
function comparedLine(engine) {
  if (!engine || typeof engine !== 'object' || !engine.biometric) return '';
  const compared = Number(engine.comparedAgainst) || 0;
  const open = Number(engine.pool?.openWithPhotos);
  return Number.isFinite(open) && open > 0
    ? t('Compared with {x} of {y} open cases', { x: compared, y: open })
    : t('Compared with {x} open cases', { x: compared });
}

const CWC_OUTCOMES = [
  { id: 'child_located_safe', label: msg('Child located safe') },
  { id: 'shelter_intake_required', label: msg('Shelter or CCI admission') },
  { id: 'escalated_police', label: msg('Refer to police') },
  { id: 'duplicate_or_invalid', label: msg('Duplicate / invalid') },
];

/**
 * The two views are different jobs, so they are different pages.
 *
 * *Matches* is a biometric decision: a face was compared to an open case and an
 * officer confirms or rejects it. *Sightings* is intake: a report that matched
 * nothing, needing welfare follow-up rather than identification. Mixed into one
 * list, the handful that need a police decision were buried among the many that
 * need a CWC one.
 */
const VIEWS = {
  matches: {
    title: msg('Matches'),
    blurb: msg(
      'Sightings that face matching linked to an open case. A score is a reason to look, never a decision: you confirm, and only then is a family contacted.'
    ),
    belongs: (f) => Boolean(f.matchedReportId),
    filters: [
      { id: 'needs_review', label: msg('Awaiting decision'), match: (f) => f.status === 'pending_review' },
      { id: 'matched', label: msg('Confirmed'), match: (f) => ['matched', 'formalized_case'].includes(f.status) },
      { id: 'closed', label: msg('Rejected'), match: (f) => f.status === 'rejected' },
      { id: 'all', label: msg('All'), match: () => true },
    ],
    empty: msg('No sighting has been matched to an open case.'),
  },
  sightings: {
    title: msg('Sightings'),
    blurb: msg(
      'Reports from the public that matched no open case. They need welfare follow-up by Childline and the CWC, not a decision on who the person is.'
    ),
    belongs: (f) => !f.matchedReportId,
    filters: [
      { id: 'needs_review', label: msg('Needs follow-up'), match: (f) => ['no_match', 'referred_cwc'].includes(f.status) },
      { id: 'matched', label: msg('Actioned'), match: (f) => ['cwc_followup_complete', 'formalized_case'].includes(f.status) },
      { id: 'closed', label: msg('Closed'), match: (f) => ['rejected', 'dismissed'].includes(f.status) },
      { id: 'all', label: msg('All'), match: () => true },
    ],
    empty: msg('No unmatched sightings are waiting.'),
  },
};

/** Milliseconds for sorting, whether the record holds an ISO string or a number. */
function when(value) {
  const ms = typeof value === 'number' ? value : new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Describes a score against the threshold the system actually routes on (0.35),
 * not against a round number. The bands were 80/60, which painted a genuine
 * match at 0.5 the same grey as no match at all — in the one place a reviewer
 * looks before deciding whether to open a case.
 */
function confidenceBand(score) {
  const value = Number(score) || 0;
  // Said as similarity: next to a name, 'Strong' read as 'this is them'.
  if (value >= 0.6) return { label: t('High similarity'), className: 'text-emerald-600' };
  if (value >= 0.35) return { label: t('Worth reviewing'), className: 'text-amber-600' };
  if (value > 0) return { label: t('Score too low'), className: 'text-slate-400' };
  return { label: t('No possible match'), className: 'text-slate-300' };
}

/**
 * Whether a sighting's location is only the coordinates the reporter's phone
 * filled in (photoLocation.js formatCoordinates: "Lat 19.1270, Lng 72.9050").
 */
function isCoordinateText(value) {
  return /^Lat\s-?\d/i.test(txt(value));
}

/** What the intake screen found, for the reviewer who has to weigh it. */
function screeningNote(screening) {
  if (!screening) return null;
  const verdict = sightingScreenVerdict(screening);
  // An officer looked and said what is in the photo: that is the answer.
  if (screening.officer?.verdict) {
    return {
      label: screening.officer.verdict === 'no_person'
        ? t('No person in this photo — recorded by {name}', { name: txt(screening.officer.byName) || t('an officer') })
        : t('A person in this photo — confirmed by {name}', { name: txt(screening.officer.byName) || t('an officer') }),
      className: 'bg-slate-100 text-slate-700',
    };
  }
  // The engine's evidence, said as evidence: a face it found clearly, and how
  // clearly. Never "a person was detected" — an officer's eyes decide that.
  if (verdict === 'person') {
    const q = Number(screening.quality);
    return {
      label: screening.quality != null && Number.isFinite(q)
        ? t('Clear face found · quality {q}%', { q: Math.round(q * 100) })
        : t('Clear face found'),
      className: 'bg-slate-100 text-slate-700',
    };
  }
  // The engine's only face was small or unclear — typically a passer-by far
  // behind whatever the photo is of. Not called a person (shared/face-screen.js).
  if (verdict === 'unclear_face') {
    return { label: t('No clear person in the photo — screened out of the general alert'), className: 'bg-amber-50 text-amber-700' };
  }
  if (screening.verdict === 'no_person') {
    return { label: t('No person detected — screened out of the general alert'), className: 'bg-amber-50 text-amber-700' };
  }
  if (screening.verdict === 'unverified') {
    return { label: t('Not checked: the face check did not answer'), className: 'bg-slate-100 text-slate-600' };
  }
  return null;
}

export default function FoundReports({ view = 'matches' }) {
  const t = useT();
  const d = useDisplay();
  const config = VIEWS[view] || VIEWS.matches;
  const { user } = useAuth();
  const action = useAction();
  const [rows, setRows] = useState([]);
  const [reportsById, setReportsById] = useState({});
  const [followups, setFollowups] = useState({});
  const [intakes, setIntakes] = useState({});
  const [compareModal, setCompareModal] = useState(null);
  // { sighting, matched } while the confirmation dialog is open.
  const [confirming, setConfirming] = useState(null);
  const [filter, setFilter] = useState('needs_review');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Photos an officer chose to see despite the screen holding them back.
  const [revealed, setRevealed] = useState({});
  // The sighting whose photograph is open full size.
  // The sighting whose photos are open full size (PhotoViewer, which closes on Back).
  const [viewing, setViewing] = useState(null);
  // An officer's own reading of a photo, recorded over the face screen's.
  const recordScreening = (f, verdict) => action.run(`screening-${f.id}`, async () => {
    const data = await api.post(`/reports/found/${f.id}/screening`, { verdict });
    if (data?.foundReport) setRows((list) => list.map((row) => (row.id === f.id ? data.foundReport : row)));
  }, verdict ? msg('Recorded: no person in this photo.') : msg('Your correction was withdrawn.'));
  // Street addresses looked up for sightings sent before they were kept.
  const [addressLookup, setAddressLookup] = useState({});
  const lookUpAddress = async (f) => {
    setAddressLookup((m) => ({ ...m, [f.id]: { busy: true } }));
    try {
      const data = await api.post(`/reports/found/${f.id}/address`);
      setRows((list) => list.map((row) => (row.id === f.id ? { ...row, geoAddress: data?.geoAddress || row.geoAddress } : row)));
      setAddressLookup((m) => ({ ...m, [f.id]: null }));
    } catch (e) {
      setAddressLookup((m) => ({ ...m, [f.id]: { error: txt(e?.message) || 'Request failed' } }));
    }
  };

  // A notification links to one sighting, so arriving from an alert has to land
  // on that card rather than on a list of twenty-five.
  const [search] = useSearchParams();
  const highlightId = search.get('id') || '';
  const cardRefs = useRef({});

  const canConfirm = ['super_admin', 'admin', 'police', 'sjpu'].includes(user.role);
  const canSearchAgain = SEARCH_AGAIN_ROLES.includes(user.role);
  const canPlace = PLACEMENT_ROLES.includes(user.role);
  // { [sightingId]: { linked, engine } } after "Search again" answers.
  const [searches, setSearches] = useState({});
  // { [sightingId]: { state, district } } while "Set district" is open.
  const [placements, setPlacements] = useState({});
  // Sightings an officer is closing as "Not a concern": id -> chosen reason.
  const [dismissing, setDismissing] = useState({});
  // The national re-match batch: { processed, linked, remaining, running }.
  const [batch, setBatch] = useState(null);
  // The face search gallery (GET /dashboard/face-index), for the national
  // desk, and its fill run: { enrolled, removed, remaining, waiting, running }.
  const [gallery, setGallery] = useState(null);
  const [fill, setFill] = useState(null);
  const canCwcFollowup = ['super_admin', 'admin', 'cwc', 'dcpu', 'state_nodal', 'sara'].includes(user.role);
  const canFormalizeIntake = ['super_admin', 'admin', 'police', 'sjpu', 'cwc', 'dcpu', 'cci', 'saa', 'state_nodal', 'sara'].includes(user.role);

  const indexCases = (data) => {
    const m = {};
    asList(data?.reports).forEach((r) => {
      if (r && r.id) m[r.id] = r;
    });
    setReportsById(m);
  };

  const load = useCallback(() => {
    setError('');
    api.get('/reports/found/all')
      .then((d) => setRows(asList(d?.foundReports)))
      // A swallowed failure here is indistinguishable from an empty queue, which
      // is the difference between "nothing to do" and "you are not being shown
      // the reports".
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api.get('/reports').then(indexCases).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const loadGallery = useCallback(() => {
    if (user.role !== 'super_admin') return;
    api.get('/dashboard/face-index').then(setGallery).catch(() => setGallery(null));
  }, [user.role]);
  useEffect(loadGallery, [loadGallery]);

  // A sighting queue that only loads once is a queue an officer has to remember
  // to refresh. The whole point of this page is that something arrives while
  // nobody is looking at it, so it refreshes itself on roughly the cadence the
  // alert bell polls on.
  //
  // Two things distinguish a background refresh from the first load. It never
  // surfaces an error: a transient failure (this list is the heaviest request
  // the worker serves, and it has tripped the CPU limit) would otherwise paint a
  // red banner over a queue that was fine a moment ago and will be fine again
  // in fifteen seconds; the last good rows stay on screen instead. And the case
  // register, which changes rarely and costs as much to fetch, refreshes a
  // third as often rather than in lockstep with the sightings.
  const refreshSightings = useCallback(() => {
    api.get('/reports/found/all').then((d) => setRows(asList(d?.foundReports))).catch(() => {});
  }, []);
  const refreshCases = useCallback(() => {
    api.get('/reports').then(indexCases).catch(() => {});
  }, []);
  // Both pause while the tab is hidden (usePolling.js).
  usePolling(refreshSightings, 15000);
  usePolling(refreshCases, 45000);

  // Arriving from an alert: show every status so the linked sighting cannot be
  // hidden by whichever filter happened to be selected, then scroll to it.
  useEffect(() => {
    if (highlightId) setFilter('all');
  }, [highlightId]);

  // Scroll to the linked card once, not on every refresh. The queue now
  // re-fetches every fifteen seconds, and `rows` is a fresh array each time —
  // without this guard the page would yank back to the highlighted card on
  // every tick while an officer is reading something further down.
  const scrolledFor = useRef('');
  useEffect(() => {
    if (!highlightId || !rows.length || scrolledFor.current === highlightId) return;
    const node = cardRefs.current[highlightId];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledFor.current = highlightId;
    }
  }, [highlightId, rows]);

  // Only the records this view is responsible for.
  const scoped = useMemo(() => rows.filter((f) => f && typeof f === 'object' && config.belongs(f)), [rows, config]);

  const counts = useMemo(
    () => Object.fromEntries(config.filters.map((tab) => [tab.id, scoped.filter(tab.match).length])),
    [scoped, config]
  );

  /**
   * Unreviewed first, then by score, then newest. The queue is worked from the
   * top, so the order is the triage.
   */
  const visible = useMemo(() => {
    const tab = config.filters.find((t) => t.id === filter) || config.filters[0];
    return scoped
      .filter(tab.match)
      .slice()
      .sort((a, b) => {
        const pending = (f) => (f.status === 'pending_review' ? 0 : 1);
        if (pending(a) !== pending(b)) return pending(a) - pending(b);
        const scoreA = Number(a.matchScore) || 0;
        const scoreB = Number(b.matchScore) || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return when(b.createdAt) - when(a.createdAt);
      });
  }, [scoped, filter, config]);

  /** Names the engine that actually ran, rather than asserting a provider. */
  const engine = useMemo(() => rows.find((f) => txt(f?.matchEngine?.provider))?.matchEngine || null, [rows]);
  // Built at render rather than inside the memo, so it follows a language switch.
  const engineLabel = engine
    ? {
        text: engine.biometric
          ? t('Face match · {provider}', { provider: txt(engine.provider) })
          : t('Compared by details · {provider}', { provider: txt(engine.provider) }),
        biometric: Boolean(engine.biometric),
        provider: txt(engine.provider),
      }
    : { text: t('No comparison run yet'), biometric: false, provider: 'none' };

  // Reject or refer. Confirming a match goes through the dialog instead.
  // Rejecting a linked sighting is "not this person": the sighting moves to the
  // next candidate the engines proposed, or back to its queue.
  const review = (f, decision) => action.run(
    `review:${f.id}`,
    async () => {
      await api.post(`/reports/found/${f.id}/review`, { decision });
      load();
    },
    decision === 'refer_cwc'
      ? msg('Referred to 1098/CWC.')
      : f.matchedReportId ? msg('Marked as not this person.') : msg('Match rejected.')
  );

  // Runs the face search again for one sighting, from where it was reported.
  const searchAgain = (f) => action.run(`rematch:${f.id}`, async () => {
    const data = await api.post(`/reports/found/${f.id}/rematch`);
    setSearches((rows) => ({ ...rows, [f.id]: { linked: Boolean(data?.linked), engine: data?.engine && typeof data.engine === 'object' ? data.engine : null } }));
    load();
  });

  // "Not a concern": closes the sighting and deletes its photo now
  // (POST /reports/found/:id/dismiss, shared/sighting-misuse.js).
  const dismissSighting = (f) => {
    const reason = dismissing[f.id];
    return action.run(`dismiss:${f.id}`, async () => {
      await api.post(`/reports/found/${f.id}/dismiss`, { reason });
      setDismissing((rows) => {
        const next = { ...rows };
        delete next[f.id];
        return next;
      });
      load();
    }, reason === 'misuse' ? msg('Dismissed as misuse. The photo was deleted.') : msg('Closed as not a concern. The photo was deleted.'));
  };

  // Places a sighting the reporter gave no district for.
  const placeSighting = (f) => action.run(`place:${f.id}`, async () => {
    const form = placements[f.id] || {};
    await api.post(`/reports/found/${f.id}/place`, {
      state: txt(form.state) || txt(user.jurisdiction?.state),
      district: txt(form.district),
    });
    setPlacements((rows) => {
      const next = { ...rows };
      delete next[f.id];
      return next;
    });
    load();
  }, msg('Sighting placed in the district.'));

  // The national desk re-runs the search for every sighting that needs it,
  // a batch at a time, until none is left.
  const runBatch = () => action.run('rematch-batch', async () => {
    let since = null;
    let processed = 0;
    let linked = 0;
    let last = null;
    for (let round = 0; round < 50; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await api.post('/dashboard/rematch-sightings', { limit: 10, ...(since ? { since } : {}) });
      since = last?.since || since;
      processed += Number(last?.processed) || 0;
      linked += Number(last?.linked) || 0;
      setBatch({ processed, linked, remaining: Number(last?.remaining) || 0, running: true });
      if (!last || !(Number(last.remaining) > 0) || !(Number(last.processed) > 0)) break;
    }
    setBatch({ processed, linked, remaining: Number(last?.remaining) || 0, running: false });
    load();
  });

  // The national desk fills the face search gallery a batch at a time,
  // pausing between batches as long as the server says (Aarakshak's pilot
  // allows 30 calls a minute), until nothing is left or a batch gets nowhere.
  // `retryRefused` also sends again the photos refused for a reason other
  // than the face (POST /dashboard/face-index/backfill).
  const runFill = (retryRefused = false) => action.run('index-fill', async () => {
    let since = null;
    let enrolled = 0;
    let removed = 0;
    let last = null;
    let previous = Infinity;
    let limitedInARow = 0;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // A batch request that fails outright (the network, a busy Worker) is
    // tried twice more, half a minute apart, before the run gives up.
    const batch = async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return await api.post('/dashboard/face-index/backfill', { limit: 10, ...(since ? { since } : {}), ...(retryRefused ? { retryRefused: true } : {}) });
        } catch (err) {
          if (attempt >= 2) throw err;
          // eslint-disable-next-line no-await-in-loop
          await pause(30000);
        }
      }
    };
    for (let round = 0; round < 200; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await batch();
      since = last?.since || since;
      enrolled += Number(last?.enrolled) || 0;
      removed += Number(last?.removed) || 0;
      const remaining = Number(last?.remaining) || 0;
      setFill({ enrolled, removed, remaining, waiting: false, running: true });
      // The gallery line counts along with the run instead of waiting for its end.
      const added = Number(last?.enrolled) || 0;
      if (added) setGallery((g) => (g?.counts ? { ...g, counts: { ...g.counts, enrolled: g.counts.enrolled + added } } : g));
      if (!last?.enabled || remaining <= 0) break;
      if (last.rateLimited) {
        limitedInARow += 1;
        if (limitedInARow > 3) break;
      } else {
        limitedInARow = 0;
        if (remaining >= previous) break;
      }
      previous = remaining;
      setFill({ enrolled, removed, remaining, waiting: true, running: true });
      // eslint-disable-next-line no-await-in-loop
      await pause(Math.min(90000, Math.max(0, Number(last.waitMs) || 0)));
    }
    setFill({ enrolled, removed, remaining: Number(last?.remaining) || 0, waiting: false, running: false });
    loadGallery();
  });

  // The dialog's submit: throws on refusal, so the reason shows in the dialog.
  const confirmMatch = async (verification) => {
    const { sighting } = confirming;
    await api.post(`/reports/found/${sighting.id}/review`, { decision: 'matched', verification });
    setConfirming(null);
    load();
  };

  const cwcFollowup = (f) => action.run(
    `cwc:${f.id}`,
    async () => {
      const form = followups[f.id] || { outcome: 'child_located_safe', note: '' };
      await api.post(`/reports/found/${f.id}/cwc-followup`, form);
      setFollowups((rows) => ({ ...rows, [f.id]: { outcome: 'child_located_safe', note: '' } }));
      load();
    },
    msg('Follow-up recorded.')
  );

  const formalizeIntake = (f) => action.run(
    `intake:${f.id}`,
    async () => {
      const form = intakes[f.id] || {};
      await api.post(`/reports/found/${f.id}/formal-intake`, {
        childName: form.childName || 'Unknown child',
        guardianName: form.guardianName || 'Unknown guardian',
        intakeAuthority: form.intakeAuthority || user.org || user.name,
        admissionDate: form.admissionDate || new Date().toISOString().slice(0, 10),
        nextReviewDate: form.nextReviewDate || '',
        ageApprox: form.ageApprox || f.ageApprox || '',
        gender: form.gender || f.gender || 'Other',
        note: form.note || '',
      });
      setIntakes((rows) => ({ ...rows, [f.id]: {} }));
      load();
    },
    msg('Formal case opened')
  );

  const setFollowup = (id, key) => (e) => {
    setFollowups((rows) => ({
      ...rows,
      [id]: { outcome: 'child_located_safe', note: '', ...(rows[id] || {}), [key]: e.target.value },
    }));
  };

  const setIntake = (id, key) => (e) => {
    setIntakes((rows) => ({
      ...rows,
      [id]: {
        childName: 'Unknown child',
        guardianName: 'Unknown guardian',
        intakeAuthority: user.org || user.name,
        admissionDate: new Date().toISOString().slice(0, 10),
        nextReviewDate: '',
        ageApprox: '',
        gender: 'Other',
        note: '',
        ...(rows[id] || {}),
        [key]: e.target.value,
      },
    }));
  };

  useBackClose(!!compareModal, () => setCompareModal(null));
  // Both photos of the open comparison, full screen (PhotoViewer).
  const [compareFull, setCompareFull] = useState(false);
  useEffect(() => { if (!compareModal) setCompareFull(false); }, [compareModal]);

  const openConfirm = (sighting, matched) => {
    action.clear();
    setCompareModal(null);
    setConfirming({ sighting, matched });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/5 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t(config.title)}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t(config.blurb)}</p>
        </div>
        {/*
          Names the engine that actually ran, from the sighting data. This
          previously read "Aarakshak Live AI v1.82" regardless of what was
          configured, which tells a reviewer a score is biometric when it may
          not be.
        */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            <span className={`h-1.5 w-1.5 rounded-full ${engineLabel.biometric ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {engineLabel.text}
          </div>
          {/*
            After an outage, or once a second engine or new settings are in
            place: search again every stored sighting whose last search had no
            face comparison, fell short of the budget or ran under other
            settings. The national desk only.
          */}
          {user.role === 'super_admin' && (
            <div className="text-right">
              <button
                type="button"
                onClick={runBatch}
                disabled={action.pending}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50"
              >
                {action.busy('rematch-batch') ? t('Searching stored sightings again…') : t('Search stored sightings again')}
              </button>
              {batch && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t('{n} searched again, {linked} sent for review, {remaining} left', { n: batch.processed, linked: batch.linked, remaining: batch.remaining })}
                </p>
              )}
              <ActionMessage action={action} id="rematch-batch" />
            </div>
          )}
          {/*
            The face search gallery, once one is configured: how many open
            cases it holds, and a run that enrols the rest and removes the
            faces of cases no longer open. The national desk only.
          */}
          {user.role === 'super_admin' && gallery?.enabled && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => runFill()}
                disabled={action.pending}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50"
              >
                {action.busy('index-fill') ? t('Adding case photos to face search…') : t('Add case photos to face search')}
              </button>
              {gallery.counts && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t('{enrolled} of {open} open cases are in face search; {needsPhoto} need a better photo', gallery.counts)}
                </p>
              )}
              {gallery.counts?.weak > 0 && (
                <p className="mt-1 text-[11px] text-slate-500">{t('{weak} of them with a small or unclear face', gallery.counts)}</p>
              )}
              {gallery.counts?.refused > 0 && (
                <p className="mt-1 text-[11px] text-amber-700">
                  {t('{refused} photos not accepted by face search', gallery.counts)}
                  {' · '}
                  <button type="button" onClick={() => runFill(true)} disabled={action.pending} className="font-semibold underline">
                    {t('Try refused photos again')}
                  </button>
                </p>
              )}
              {!gallery.gallery && <p className="mt-1 text-[11px] font-semibold text-red-600">{t('Face search did not answer')}</p>}
              {gallery.gallery && gallery.gallery.galleryMatches === false && (
                <p className="mt-1 text-[11px] font-semibold text-red-600">
                  {t('The face search key belongs to another account: {name}', { name: gallery.gallery.galleryId || '?' })}
                </p>
              )}
              {fill && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t('{enrolled} added, {removed} removed, {remaining} left', fill)}
                  {fill.waiting ? ` · ${t('waiting for the per-minute limit')}` : ''}
                </p>
              )}
              <ActionMessage action={action} id="index-fill" />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {config.filters.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === tab.id
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t(tab.label)}
            <span className={`ml-1.5 ${filter === tab.id ? 'text-white/70' : 'text-slate-400'}`}>
              {counts[tab.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {t('Could not load the list: {error}.', { error })}{' '}
          <button onClick={load} className="font-semibold underline">{t('Retry')}</button>
        </div>
      )}

      {loading && <p className="text-sm text-gray-400">{t('Loading the list…')}</p>}

      {!loading && !error && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {scoped.length === 0 ? t(config.empty) : t('Nothing in this view')}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {scoped.length === 0
              ? t('Reports from the public arrive here the moment they are submitted, and you are alerted.')
              : t('Try another filter.')}
          </p>
        </div>
      )}

      {/*
        One sighting per row rather than a two-column grid. Cards of unequal
        height left large empty gaps, and a queue reads as a queue: same shape,
        top to bottom, in the order it should be worked.

        Each card has its own crash guard: a sighting with a malformed field
        shows a notice in its place and the rest of the queue stays workable.
      */}
      <div className="space-y-4">
        {visible.map((f) => {
          const matched = (f.matchedReport && typeof f.matchedReport === 'object' ? f.matchedReport : null)
            || (f.matchedReportId ? reportsById[f.matchedReportId] : null);
          const scorePct = Math.round((Number(f.matchScore) || 0) * 100);
          const band = confidenceBand(f.matchScore);
          const screen = screeningNote(f.screening);
          // Who was seen, and who the matched case is about. Childline/CWC,
          // CCI intake and "reunite" are child-protection steps; for a woman
          // or adult the next step is to verify with the person.
          const sightingAdult = isAdultCase(f);
          const matchedAdult = matched ? isAdultCase(matched) : false;
          const adultFlow = sightingAdult || matchedAdult;
          const cwc = f.cwcFollowup && typeof f.cwcFollowup === 'object' ? f.cwcFollowup : null;
          const familyPhone = matched ? txt(matched.parentPhone) : '';
          // The candidates the engines proposed, best first, that this desk may
          // open; the current one is the one being decided.
          const current = currentCandidate(f);
          const proposedCandidates = asList(f.matchCandidates).filter((c) => c && c.status === 'proposed');
          const rejectedCount = asList(f.matchCandidates).filter((c) => c && c.status === 'rejected').length;
          const hasNext = proposedCandidates.some((c) => c.reportId !== f.matchedReportId);
          // About the case photo the match was made on, not only the main one.
          const casePhotoFlag = matched
            ? photoCheckFlag((viewPhotosOf(matched).find((p) => p.id === (photoPairOf(f, matched)?.case || MAIN_PHOTO)) || { check: matched.photoCheck }).check)
            : null;
          const lastSearch = comparedLine(f.matchEngine);
          const searched = searches[f.id];
          const reported = f.reportedLocation && typeof f.reportedLocation === 'object' ? f.reportedLocation : f;
          const needsPlacing = canPlace && !txt(reported.district) && !f.anonymizedAt && !['matched', 'rejected'].includes(f.status);
          const placing = placements[f.id];
          return (
            <ErrorBoundary key={f.id}>
            <div
              ref={(node) => { cardRefs.current[f.id] = node; }}
              className={`card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${
                highlightId === f.id ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 sm:truncate">{d(f.reporterName)}</p>
                  <p className="text-xs text-gray-500">
                    {timeAgo(f.createdAt)} • {txt(f.reporterPhone) ? <PhoneLink phone={f.reporterPhone} /> : t('confidential')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                  <span className="text-[11px] text-gray-400">{t('Seen:')}</span>
                  <CategoryBadge category={personCategoryOf(f)} />
                  <StatusBadge status={f.status} />
                </div>
              </div>

              {/*
                Photo, detail and candidate across one row. The photograph the
                citizen sent is the thing being reviewed and used to be reachable
                only through a modal, leaving the reviewer judging a percentage
                without ever seeing the face it came from.
              */}
              <div className="mt-4 grid grid-cols-[6rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4 lg:flex lg:flex-row lg:items-start">
                {/*
                  A photograph is shown when the screen found a person in it.
                  Anything else stays behind a click: the public upload endpoint
                  receives whatever a camera was pointed at, and a review queue
                  that renders all of it puts arbitrary images from strangers in
                  front of officers all day. Nothing is hidden from the reviewer
                  — it is one click away, with the reason it was held back.
                */}
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-28 sm:w-28">
                  {/* A text report has no photo to hold back: it falls through
                      to "No photo — text report". */}
                  {f.screening && !['person', 'no_photo'].includes(sightingScreenVerdict(f.screening)) && !revealed[f.id] ? (
                    <button
                      onClick={() => setRevealed((r) => ({ ...r, [f.id]: true }))}
                      className="grid h-full w-full place-items-center gap-1 px-2 text-center hover:bg-slate-200"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.3M6.2 6.6C4.1 8 2.6 10 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.6-1.2" />
                      </svg>
                      <span className="text-[10px] font-semibold text-slate-500">
                        {sightingScreenVerdict(f.screening) === 'no_person'
                          ? t('No person detected')
                          : sightingScreenVerdict(f.screening) === 'unclear_face' ? t('No clear person') : t('Not screened')}
                      </span>
                      <span className="text-[10px] text-indigo-600 underline">{t('Show anyway')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setViewing(f)}
                      aria-label={t('Open the photo full size')}
                      className="block h-full w-full cursor-zoom-in"
                    >
                      <ProtectedImage
                        src={txt(f.photoUrl) || `/api/reports/photo/${f.id}`}
                        alt={t('Reported sighting')}
                        className="h-full w-full object-contain"
                        fallback={
                          <div className="grid h-full w-full place-items-center px-2 text-center text-[11px] text-slate-400">
                            {t('No photo — text report')}
                          </div>
                        }
                      />
                      {/* The reporter sent more than one photo. */}
                      {viewPhotosOf(f).length > 1 && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {t('{n} photos', { n: viewPhotosOf(f).length })}
                        </span>
                      )}
                    </button>
                  )}
                  {/* Other photos the screen found no person in: held back
                      until the officer asks, as a main photo would be. */}
                  {!revealed[f.id] && viewPhotosOf(f).some((p) => p.id !== MAIN_PHOTO && p.check?.verdict === 'no_face') && (
                    <button
                      type="button"
                      onClick={() => setRevealed((r) => ({ ...r, [f.id]: true }))}
                      className="absolute inset-x-0 top-0 bg-white/90 px-1 py-0.5 text-[10px] font-semibold text-indigo-700 underline"
                    >
                      {t('Show the photos with no person')}
                    </button>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <p className="flex items-start gap-1.5 text-sm font-medium text-slate-800">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    <span className="min-w-0">
                      {/*
                        The street address leads when the reporter's phone gave
                        only coordinates: "Lat 19.1270, Lng 72.9050" is not a
                        place anyone can drive to. What a reporter typed stays
                        first, with the address beneath it.
                      */}
                      {txt(f.geoAddress) && isCoordinateText(f.foundLocation)
                        ? (
                          <>
                            {txt(f.geoAddress)}
                            <span className="block text-xs font-normal text-slate-400">{d(f.foundLocation)}</span>
                          </>
                        )
                        : d(f.foundLocation)}
                      {txt(f.geoAddress) && !isCoordinateText(f.foundLocation) && (
                        <span className="block text-xs font-normal text-slate-600">{t('Near {address}', { address: txt(f.geoAddress) })}</span>
                      )}
                      {!txt(f.geoAddress) && coordsOf(f) && !f.anonymizedAt && (
                        <span className="block text-xs font-normal">
                          <button
                            type="button"
                            onClick={() => lookUpAddress(f)}
                            disabled={addressLookup[f.id]?.busy}
                            className="inline-flex min-h-11 items-center font-semibold text-khozo-dark underline underline-offset-2 hover:text-ink disabled:opacity-60 sm:min-h-0"
                          >
                            {addressLookup[f.id]?.busy ? t('Looking up the address…') : t('Show the street address')}
                          </button>
                          {addressLookup[f.id]?.error && <span className="ml-2 text-amber-700">{t(addressLookup[f.id].error)}</span>}
                        </span>
                      )}
                      {(txt(f.district) || txt(f.state)) && (
                        <span className="block text-xs font-normal text-slate-500">
                          {d.places(f.district, f.state)}
                          {f.locationSource === 'coordinates' && ` · ${t('from the reporter’s location')}`}
                        </span>
                      )}
                      {!txt(f.state) && !txt(f.district) && (
                        <span className="block text-xs font-normal text-amber-600">
                          {t('No place given, so every review desk can see it')}
                        </span>
                      )}
                    </span>
                  </p>
                  {coordsOf(f) && <MapsLink lat={f.lat} lng={f.lng} />}
                  {txt(f.note) && <p className="text-sm italic text-slate-600">“{d(f.note)}”</p>}
                  {/* For an adult, why the reporter thought they need help (shared/sighting-misuse.js). */}
                  {sightingAdult && !f.anonymizedAt && (
                    <p className="text-xs text-slate-600">
                      {CONCERN_REASON_LABELS[f.concernReason]
                        ? t('Why the reporter thought they need help: {reason}', { reason: t(CONCERN_REASON_LABELS[f.concernReason]) })
                        : t('The reporter gave no reason for thinking they need help.')}
                    </p>
                  )}
                  {['missing', 'expired', 'unavailable'].includes(f.humanCheck) && (
                    <p className="text-xs text-amber-700">{t('We could not check that a person sent this. It came from a phone with no signal, an old copy of the page, or while the check was not working.')}</p>
                  )}
                  {screen && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${screen.className}`}>
                        {screen.label}
                      </span>
                      {/*
                        The officer corrects the machine. One tap records "no
                        person in this photo" (audited); the sighting leaves
                        the reverse search and the card stops claiming a face.
                      */}
                      {(f.photoFile || f.photoUrl) && !f.anonymizedAt && (
                        f.screening?.officer?.verdict ? (
                          <button
                            type="button"
                            onClick={() => recordScreening(f, null)}
                            disabled={action.pending}
                            className="inline-flex min-h-11 items-center text-xs font-semibold text-slate-500 underline underline-offset-2 hover:text-ink disabled:opacity-60 sm:min-h-0"
                          >
                            {t('Undo')}
                          </button>
                        ) : sightingScreenVerdict(f.screening) !== 'no_person' && (
                          <button
                            type="button"
                            onClick={() => recordScreening(f, 'no_person')}
                            disabled={action.pending}
                            className="inline-flex min-h-11 items-center text-xs font-semibold text-khozo-dark underline underline-offset-2 hover:text-ink disabled:opacity-60 sm:min-h-0"
                          >
                            {t('No person in this photo')}
                          </button>
                        )
                      )}
                    </span>
                  )}
                  <ActionMessage action={action} id={`screening-${f.id}`} />
                </div>

                <div className="col-span-2 shrink-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4 lg:w-96">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                    {matched && (
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-indigo-200 bg-indigo-100">
                        <ProtectedImage
                          src={txt(matched.photoUrl) || `/api/reports/photo/${matched.id}`}
                          alt={d(matched.childName)}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    )}
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('Closest open case')}</span>
                        <p className="truncate text-base font-bold capitalize text-gray-900">
                          {matched ? d(matched.childName) : t('No possible match')}
                        </p>
                        {matched && (
                          <p className="truncate text-xs text-gray-500">
                            {t('Case #{id}', { id: txt(matched.id) })} • {d(matched.address) || d.place(matched.district)}
                          </p>
                        )}
                      </div>
                    </div>
                    {matched && (
                      <div className="shrink-0 text-right">
                        <div className={`text-2xl font-extrabold ${band.className}`}>{scorePct}%</div>
                        <p className="text-[10px] font-medium text-gray-400">{band.label}</p>
                      </div>
                    )}
                  </div>
                  {/* Beside every score, every time: an engine proposes, an officer decides. */}
                  {matched && (
                    <p className="mt-2 text-xs font-medium text-slate-500">{t('A similarity score, not a confirmed identity. Verify in person before anyone is contacted.')}</p>
                  )}

                  {matched ? (
                    <>
                      {/*
                        Whether a second engine corroborated this, or looked at
                        all. One engine proposing a face is a lead; an officer
                        about to contact a family needs to know which of the
                        two they are looking at.
                      */}
                      <div className="mt-2">
                        <EngineScores candidate={current} provider={txt(f.matchEngine?.provider) || engineLabel.provider} lines={matchLinesOf(f)} />
                      </div>
                      {casePhotoFlag && (
                        <p className={`mt-2 rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 ${casePhotoFlag.className}`}>{t(casePhotoFlag.label)}</p>
                      )}
                      {proposedCandidates.length > 1 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('Possible matches, best first')}</p>
                          <ol className="mt-1 space-y-1">
                            {proposedCandidates.map((c) => (
                              <li
                                key={c.reportId}
                                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs ${
                                  c.reportId === f.matchedReportId ? 'bg-indigo-50 font-semibold ring-1 ring-indigo-200' : 'bg-white ring-1 ring-slate-200'
                                }`}
                              >
                                <span className="min-w-0 truncate">
                                  {txt(c.rank) ? `${txt(c.rank)}. ` : ''}{d(c.report?.childName) || t('Case #{id}', { id: txt(c.reportId) })}
                                </span>
                                <span className="shrink-0 text-slate-500">
                                  {Math.round((Number(c.score) || 0) * 100)}%
                                  {c.corroborated ? ` · ${t('two checks')}` : c.notChecked ? ` · ${t('not checked')}` : ''}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {rejectedCount > 0 && (
                        <p className="mt-2 text-[11px] text-slate-500">{t('{n} possible match(es) already marked as not this person', { n: rejectedCount })}</p>
                      )}
                      <button
                        onClick={() => setCompareModal({ sighting: f, matched })}
                        className="mt-3 w-full rounded-lg border border-indigo-200 bg-white py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 sm:text-xs"
                      >
                        {t('Compare the two photographs')}
                      </button>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      {f.matchEngine && !f.matchEngine.biometric
                        ? t('No faces were compared, so no possible match is shown.')
                        : t('No open case was matched to this photograph.')}
                    </p>
                  )}
                  {lastSearch && <p className="mt-2 text-[11px] text-slate-500">{lastSearch}</p>}
                  {canSearchAgain && searchable(f) && (
                    <>
                      <button
                        type="button"
                        onClick={() => searchAgain(f)}
                        disabled={action.pending}
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {action.busy(`rematch:${f.id}`) ? t('Searching the open cases…') : t('Search again')}
                      </button>
                      <ActionMessage action={action} id={`rematch:${f.id}`} />
                      {searched && !action.busy(`rematch:${f.id}`) && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          {searched.linked
                            ? t('A possible match was found and sent for review.')
                            : searched.engine && !searched.engine.biometric
                              ? t('No face comparison was made. Try again later.')
                              : t('Searched again: no new possible match.')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/*
                A sighting with no district reaches every review desk, and its
                search is spent nearest-first from nowhere. Placing it routes it
                to that district's desks and searches again from there.
              */}
              {needsPlacing && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  {placing ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        className="field py-2 text-xs"
                        value={placing.state ?? txt(user.jurisdiction?.state)}
                        onChange={(e) => setPlacements((rows) => ({ ...rows, [f.id]: { ...placing, state: e.target.value } }))}
                        placeholder={t('State')}
                        disabled={user.role !== 'super_admin' && Boolean(txt(user.jurisdiction?.state))}
                      />
                      <input
                        className="field py-2 text-xs"
                        value={placing.district || ''}
                        onChange={(e) => setPlacements((rows) => ({ ...rows, [f.id]: { ...placing, district: e.target.value } }))}
                        placeholder={t('District')}
                      />
                      <button
                        type="button"
                        className="btn-primary px-4 py-2 text-xs"
                        disabled={action.pending || !txt(placing.district) || !(txt(placing.state) || txt(user.jurisdiction?.state))}
                        onClick={() => placeSighting(f)}
                      >
                        {t('Set district')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-semibold text-amber-800 underline"
                      onClick={() => setPlacements((rows) => ({ ...rows, [f.id]: { state: txt(user.jurisdiction?.state), district: '' } }))}
                    >
                      {t('Set district')}
                    </button>
                  )}
                  <ActionMessage action={action} id={`place:${f.id}`} />
                </div>
              )}

              {f.status === 'pending_review' && (
                <>
                  <div className={`mt-4 grid gap-2 ${(canConfirm ? 1 : 0) + (adultFlow ? 1 : 2) === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                    {canConfirm && (
                      // Opens the verification dialog; nothing is confirmed by this click.
                      <button
                        data-action="confirm-match"
                        onClick={() => openConfirm(f, matched)}
                        disabled={action.pending || !matched}
                        className="btn-primary py-2.5 text-xs font-semibold"
                      >
                        {matchedAdult ? t('Confirm match…') : t('Confirm & reunite…')}
                      </button>
                    )}
                    <button onClick={() => review(f, 'rejected')} disabled={action.pending} className="btn-ghost py-2.5 text-xs">
                      {f.matchedReportId ? (hasNext ? t('Not this person — show next') : t('Not this person')) : t('Reject')}
                    </button>
                    {!adultFlow && (
                      <button onClick={() => review(f, 'refer_cwc')} disabled={action.pending} className="btn-ghost py-2.5 text-xs">{t('Refer to 1098/CWC')}</button>
                    )}
                  </div>
                  <ActionMessage action={action} id={`review:${f.id}`} />
                </>
              )}

              {/*
                "Not a concern": a stranger photographed in the street is not a
                missing person. Closing it deletes the photo at once instead of
                keeping it for 180 days. Not while a possible match is open,
                and not once the sighting is part of a case.
              */}
              {!f.anonymizedAt && !['pending_review', 'matched', 'dismissed'].includes(f.status) && !f.formalReportId && (
                <div className="mt-3">
                  {dismissing[f.id] === undefined ? (
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center text-xs font-semibold text-gray-500 underline hover:text-ink sm:min-h-0"
                      onClick={() => setDismissing((rows) => ({ ...rows, [f.id]: '' }))}
                    >
                      {t('Not a concern…')}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-black/10 bg-gray-50 p-3 text-xs">
                      <p className="font-semibold text-gray-800">{t('Close this sighting and delete its photo now?')}</p>
                      <p className="mt-0.5 text-gray-500">{t('For a photo of someone who is not missing and not in need. This cannot be undone, and your name is recorded against the decision.')}</p>
                      <div role="radiogroup" className="mt-2 grid gap-1.5">
                        {DISMISSAL_OPTIONS.map((option) => (
                          <label key={option.id} className="flex items-start gap-2 text-gray-700">
                            <input
                              type="radio"
                              name={`dismiss-${f.id}`}
                              className="mt-0.5"
                              checked={dismissing[f.id] === option.id}
                              onChange={() => setDismissing((rows) => ({ ...rows, [f.id]: option.id }))}
                            />
                            <span>{t(option.label)}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary px-4 py-2 text-xs"
                          disabled={action.pending || !dismissing[f.id]}
                          onClick={() => dismissSighting(f)}
                        >
                          {t('Close and delete photo')}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-4 py-2 text-xs"
                          onClick={() => setDismissing((rows) => {
                            const next = { ...rows };
                            delete next[f.id];
                            return next;
                          })}
                        >
                          {t('Cancel')}
                        </button>
                      </div>
                      <ActionMessage action={action} id={`dismiss:${f.id}`} />
                    </div>
                  )}
                </div>
              )}
              {matchedAdult && ['pending_review', 'matched'].includes(f.status) && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  {t('Verify with the person first; share their location with the family only with their consent.')}
                </p>
              )}

              {/*
                After a confirmation the family has not been told: no message
                goes out on its own. For a child the next step is a call; for an
                adult it is the conversation with the person, in the case.
              */}
              {f.status === 'matched' && matched && canConfirm && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-khozo-light px-3.5 py-2.5 text-xs">
                  <span className="font-semibold text-ink">
                    {matched.familyInformedAt
                      ? t('The family has been informed.')
                      : matchedAdult
                        ? t('Next step: verify with the person')
                        : t('Next step: call the family, then record that they were informed.')}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    {!matchedAdult && !matched.familyInformedAt && familyPhone && (
                      <a href={telHref(familyPhone)} className="inline-flex min-h-11 items-center font-semibold text-khozo hover:underline sm:min-h-0">
                        📞 {t('Call the family')} · {familyPhone}
                      </a>
                    )}
                    <Link to={`/app/cases?id=${encodeURIComponent(matched.id)}`} className="inline-flex min-h-11 items-center font-semibold text-indigo-600 hover:underline sm:min-h-0">
                      {t('Open the case')}
                    </Link>
                  </span>
                </div>
              )}

              {sightingAdult && !f.matchedReportId && ['no_match', 'referred_cwc'].includes(f.status) && (
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {t('A sighting of an adult is followed up by the police station for the area. The Childline, CWC and shelter steps do not apply.')}
                </p>
              )}

              {canCwcFollowup && !sightingAdult && ['no_match', 'referred_cwc'].includes(f.status) && (
                <div className="mt-4 rounded-xl border border-black/5 p-4 bg-white">
                  <p className="text-sm font-semibold text-gray-800">{t('CWC / DCPU follow-up action')}</p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <select
                      className="field text-xs py-2"
                      value={(followups[f.id]?.outcome) || 'child_located_safe'}
                      onChange={setFollowup(f.id, 'outcome')}
                    >
                      {CWC_OUTCOMES.map((outcome) => <option key={outcome.id} value={outcome.id}>{t(outcome.label)}</option>)}
                    </select>
                    <button className="btn-primary text-xs px-4 py-2" disabled={action.pending} onClick={() => cwcFollowup(f)}>{t('Record action')}</button>
                  </div>
                  <textarea
                    className="field mt-2 text-xs min-h-16 w-full"
                    value={(followups[f.id]?.note) || ''}
                    onChange={setFollowup(f.id, 'note')}
                    placeholder={t('Note on the follow-up')}
                  />
                  <ActionMessage action={action} id={`cwc:${f.id}`} />
                </div>
              )}

              {cwc && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                  <p className="font-semibold">{txt(cwc.label)}</p>
                  <p>
                    {txt(cwc.actorName)}
                    {cwc.completedAt && Number.isFinite(new Date(cwc.completedAt).getTime())
                      ? ` • ${new Date(cwc.completedAt).toLocaleString(currentLocale())}`
                      : ''}
                  </p>
                </div>
              )}

              {canFormalizeIntake && !sightingAdult && ['no_match', 'referred_cwc', 'cwc_followup_complete'].includes(f.status) && !f.formalReportId && (
                <div className="mt-4 rounded-xl border border-black/5 p-4 bg-white">
                  <p className="text-sm font-semibold text-gray-800">{t('Formal child-protection case')}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t('Open a formal case so the child can be admitted to a CCI, when no missing case matches.')}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                      className="field text-xs py-2"
                      value={(intakes[f.id]?.childName) || ''}
                      onChange={setIntake(f.id, 'childName')}
                      placeholder={t('Temporary child identifier')}
                    />
                    <input
                      className="field text-xs py-2"
                      value={(intakes[f.id]?.intakeAuthority) || ''}
                      onChange={setIntake(f.id, 'intakeAuthority')}
                      placeholder={user.org || user.name}
                    />
                    <input
                      className="field text-xs py-2"
                      type="date"
                      value={(intakes[f.id]?.admissionDate) || new Date().toISOString().slice(0, 10)}
                      onChange={setIntake(f.id, 'admissionDate')}
                    />
                    <input
                      className="field text-xs py-2"
                      type="date"
                      value={(intakes[f.id]?.nextReviewDate) || ''}
                      onChange={setIntake(f.id, 'nextReviewDate')}
                    />
                  </div>
                  <textarea
                    className="field mt-2 text-xs min-h-16 w-full"
                    value={(intakes[f.id]?.note) || ''}
                    onChange={setIntake(f.id, 'note')}
                    placeholder={t('Note, rehabilitation plan and steps to trace the family')}
                  />
                  <button
                    className="btn-primary mt-2.5 w-full py-2 text-xs font-semibold"
                    disabled={action.pending || ((intakes[f.id]?.note) || '').trim().length < 10}
                    onClick={() => formalizeIntake(f)}
                  >
                    {action.busy(`intake:${f.id}`) ? t('Opening case…') : t('Open formal case')}
                  </button>
                  <ActionMessage action={action} id={`intake:${f.id}`} />
                </div>
              )}

              {txt(f.formalReportId) && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 border border-emerald-100">
                  <p className="font-bold">{t('Formal child-protection case created')}</p>
                  <p>{t('Case reference: {ref}', { ref: txt(f.formalReportId) })}</p>
                </div>
              )}

              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-[11px] text-gray-500 space-y-0.5">
                <p><span className="font-semibold text-gray-700">{t('Data purpose:')}</span> {txt(f.dataPurpose) || t('sighting review & child protection')}</p>
                {f.retentionUntil && Number.isFinite(new Date(f.retentionUntil).getTime()) && (
                  <p><span className="font-semibold text-gray-700">{t('Photo retained until:')}</span> {new Date(f.retentionUntil).toLocaleDateString(currentLocale())}</p>
                )}
                <p><span className="font-semibold text-gray-700">{t('Consent:')}</span> {f.photoConsent ? t('Recorded') : t('Not recorded')}</p>
                <p><span className="font-semibold text-gray-700">{t('Reporter identity:')}</span> {f.confidentialReporter ? t('Confidential') : t('Visible')}</p>
              </div>
            </div>
            </ErrorBoundary>
          );
        })}
      </div>

      {/* The photographs a citizen sent, whole and large: a thumbnail is too
          small to tell a face from a reflection. */}
      {viewing && (
        <ErrorBoundary>
          <PhotoViewer
            title={txt(viewing.geoAddress) || d(viewing.foundLocation)}
            onClose={() => setViewing(null)}
            panes={[{
              label: t('Sighting photos'),
              startId: MAIN_PHOTO,
              // Another photo the screen found no person in is held back, as
              // the main one is on the card, until an officer asks to see it
              // (the card's "Show anyway").
              photos: (viewPhotosOf(viewing).length ? viewPhotosOf(viewing) : [{ id: MAIN_PHOTO, src: `/api/reports/photo/${viewing.id}` }])
                .filter((p) => p.id === MAIN_PHOTO || revealed[viewing.id] || p.check?.verdict !== 'no_face')
                .map((p) => ({ id: p.id, src: p.src })),
            }]}
          />
        </ErrorBoundary>
      )}

      {/* Side-by-side compare: both photographs whole, for looking. Confirming
          goes through the verification dialog. */}
      {compareModal && (
        <ErrorBoundary>
        <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t('Face comparison')}>
          <div className="animate-sheet-in card h-full max-h-[100dvh] w-full max-w-3xl space-y-5 overflow-y-auto overscroll-contain rounded-none bg-white px-4 pb-0 pt-0 shadow-2xl sm:h-auto sm:max-h-[94vh] sm:animate-none sm:rounded-2xl sm:px-6">
            <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b bg-white px-4 pb-3 pt-4 sm:-mx-6 sm:px-6 sm:pt-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{t('Face comparison')}</h3>
                {/* Names the engine that produced this score, not a fixed one. */}
                <p className="text-xs text-gray-500">
                  {txt(compareModal.sighting.matchEngine?.provider) || t('matcher not recorded')}
                  {compareModal.sighting.secondOpinion === 'agrees' && ` · ${t('confirmed by AWS Rekognition')}`}
                </p>
              </div>
              <button
                onClick={() => setCompareModal(null)}
                aria-label={t('Close')}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className="min-w-0 text-center">
                <span className="text-xs font-semibold text-gray-600 block mb-2">{t('Sighting photo')}</span>
                <button
                  type="button"
                  onClick={() => setCompareFull(true)}
                  title={t('View both photos full size')}
                  className="flex h-56 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border bg-slate-100 text-xs text-slate-400 hover:ring-2 hover:ring-khozo/40 sm:h-80"
                >
                  <ProtectedImage
                    src={photoUrlOf(compareModal.sighting, photoPairOf(compareModal.sighting, compareModal.matched)?.sighting) || photoUrlOf(compareModal.sighting) || (compareModal.sighting.id ? `/api/reports/photo/${compareModal.sighting.id}` : null)}
                    alt={t('Sighting')}
                    className="max-h-full max-w-full object-contain"
                    fallback={<span>{t('No sighting photo')}</span>}
                  />
                </button>
                <p className="mt-2 text-xs font-medium text-gray-700">{d(compareModal.sighting.foundLocation)}</p>
                {viewPhotosOf(compareModal.sighting).length > 1 && (
                  <p className="text-[11px] text-gray-500">{t('{n} photos sent', { n: viewPhotosOf(compareModal.sighting).length })}</p>
                )}
              </div>

              <div className="min-w-0 text-center">
                <span className="text-xs font-semibold text-indigo-600 block mb-2">
                  {isAdultCase(compareModal.matched) ? t('Missing person record') : t('Missing child record')}
                </span>
                <button
                  type="button"
                  onClick={() => setCompareFull(true)}
                  title={t('View both photos full size')}
                  className="flex h-56 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50 text-xs text-indigo-400 hover:ring-2 hover:ring-khozo/40 sm:h-80"
                >
                  <ProtectedImage
                    src={photoUrlOf(compareModal.matched, photoPairOf(compareModal.sighting, compareModal.matched)?.case) || photoUrlOf(compareModal.matched) || (compareModal.matched.id ? `/api/reports/photo/${compareModal.matched.id}` : null)}
                    alt={t('Missing child')}
                    className="max-h-full max-w-full object-contain"
                    fallback={<span>{t('No case photo')}</span>}
                  />
                </button>
                <p className="mt-2 text-xs font-bold text-gray-900">{d(compareModal.matched.childName)}</p>
                {photoPairOf(compareModal.sighting, compareModal.matched)?.case === null && (
                  <p className="text-[11px] font-semibold text-amber-700">{t('The case photo this match was found on has since been removed or replaced.')}</p>
                )}
                {viewPhotosOf(compareModal.matched).length > 1 && (
                  <p className="text-[11px] text-gray-500">
                    {photoPairOf(compareModal.sighting, compareModal.matched)?.case && photoPairOf(compareModal.sighting, compareModal.matched).case !== MAIN_PHOTO
                      ? t('Matched on one of its other photos · {n} in all', { n: viewPhotosOf(compareModal.matched).length })
                      : t('{n} photos on the case', { n: viewPhotosOf(compareModal.matched).length })}
                  </p>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setCompareFull(true)} className="btn-ghost w-full py-2 text-xs">
              {viewPhotosOf(compareModal.sighting).length + viewPhotosOf(compareModal.matched).length > 2
                ? t('View all the photos full size')
                : t('View both photos full size')}
            </button>

            <div className="rounded-xl bg-slate-50 p-3.5 text-center ring-1 ring-slate-200">
              <span className="block text-xs font-semibold text-slate-600">{t('Face similarity')}</span>
              <span className="text-3xl font-extrabold text-slate-900">
                {Math.round((Number(compareModal.sighting.matchScore) || 0) * 100)}%
              </span>
              <EngineScoreLine sighting={compareModal.sighting} />
              <span className="mt-2 block text-xs text-slate-500">
                {isAdultCase(compareModal.matched)
                  ? t('A score is a prompt to look. You are confirming this is the same person. Verify with them before anyone else is told.')
                  : t('A score is a prompt to look. You are confirming this is the same child.')}
              </span>
            </div>

            {/* Both engines, photo quality, and the sighting beside the case. */}
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200">
              <MatchEvidence sighting={compareModal.sighting} report={compareModal.matched} />
            </div>

            <div className="safe-bottom sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t bg-white px-4 py-3 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6 sm:pb-6">
              <button onClick={() => setCompareModal(null)} className="btn-ghost text-xs py-2 px-4">
                {t('Close')}
              </button>
              {canConfirm && compareModal.sighting.status === 'pending_review' && (
                <button
                  onClick={() => openConfirm(compareModal.sighting, compareModal.matched)}
                  disabled={action.pending}
                  className="btn-primary text-xs py-2 px-4"
                >
                  {isAdultCase(compareModal.matched) ? t('Confirm match…') : t('Confirm & reunite…')}
                </button>
              )}
            </div>
          </div>
        </div>
        </ErrorBoundary>
      )}

      {compareModal && compareFull && (
        <ErrorBoundary>
          <PhotoViewer
            title={t('Face comparison')}
            onClose={() => setCompareFull(false)}
            panes={[
              {
                label: t('Sighting photos'),
                startId: photoPairOf(compareModal.sighting, compareModal.matched)?.sighting || MAIN_PHOTO,
                photos: (viewPhotosOf(compareModal.sighting).length
                  ? viewPhotosOf(compareModal.sighting)
                  : [{ id: MAIN_PHOTO, src: compareModal.sighting.id ? `/api/reports/photo/${compareModal.sighting.id}` : null }])
                  .map((p) => ({ id: p.id, src: p.src, caption: txt(compareModal.sighting.geoAddress) || d(compareModal.sighting.foundLocation) })),
              },
              {
                label: isAdultCase(compareModal.matched) ? t('Missing person record') : t('Missing child record'),
                startId: photoPairOf(compareModal.sighting, compareModal.matched)?.case || MAIN_PHOTO,
                photos: (viewPhotosOf(compareModal.matched).length
                  ? viewPhotosOf(compareModal.matched)
                  : [{ id: MAIN_PHOTO, src: compareModal.matched.id ? `/api/reports/photo/${compareModal.matched.id}` : null }])
                  .map((p) => ({ id: p.id, src: p.src, caption: d(compareModal.matched.childName) })),
              },
            ]}
            footer={t('Looking at the photos does not confirm a match. Confirming asks how the person was verified: in person, by video or from documents.')}
          />
        </ErrorBoundary>
      )}

      {confirming && (
        <ErrorBoundary>
          <ConfirmMatchDialog
            report={confirming.matched}
            sighting={confirming.sighting}
            action={action}
            onSubmit={confirmMatch}
            onCancel={() => { setConfirming(null); action.clear(); }}
          />
        </ErrorBoundary>
      )}

      <ActionToast action={action} />
    </div>
  );
}
