/**
 * The face-comparison pipeline, once, for both runtimes.
 *
 * The Worker (worker/src/match.js) and the Node build (server/src/match.js)
 * reach the providers differently - a signed fetch on one, the AWS SDK on the
 * other - and used to implement the rules around them separately. They
 * drifted: one fell back to Rekognition when Aarakshak said "no face" and the
 * other did not, one dropped a candidate Rekognition never answered for and
 * the other passed it through. Each runtime now supplies only its two
 * provider calls, normalised (see `answer` below), and this module decides
 * everything else.
 *
 * The rules:
 *
 *   1. Aarakshak proposes. Every pair in the pool is compared with it.
 *   2. Rekognition confirms. Aarakshak's best five are each re-scored. A
 *      candidate Rekognition scores at or above KHOZO_REKOGNITION_CONFIRM is
 *      corroborated, and keeps the LOWER of the two scores: a second opinion
 *      confirms, it never inflates. A candidate Rekognition scores below that
 *      is withheld: two engines looked and did not agree.
 *   3. No single-engine veto. A pair Aarakshak could not answer for - no face
 *      found, an error, a timeout - is "unknown", not a score of 0, and
 *      Rekognition compares it on its own, held to its confirmation bar.
 *   4. The "not checked" lane. A candidate Rekognition is configured for but
 *      did not answer for (an error, a photo over 5 MB, a WebP it cannot
 *      read, no face found by it) is kept as an uncorroborated lead, flagged
 *      `notChecked`, never confirmed and never silently dropped.
 *   5. Every candidate records which engines answered for it.
 *
 * A normalised provider answer is one of:
 *   { status: 'answered', score, sourceFaces, targetFaces, warnings, ... }
 *   { status: 'no_face', warnings }
 *   { status: 'no_answer' | 'unsupported_format' | 'too_large' | 'not_configured' | 'not_asked', detail? }
 */
import { DISAGREEMENT_GAP, MAX_MATCH_CANDIDATES, thresholdsOf } from './match-config.js';
import { isWeakFace } from './face-screen.js';
import { MAIN_PHOTO, isBadFacePhoto, leadPhotoOf, photoCountOf, photosOf } from './photo-set.js';

export const ENGINES = {
  aarakshak: {
    provider: 'aarakshak-live-v1',
    modelVersion: 'aarakshak-fr-v1.82',
    biometric: true,
    note: 'Face comparison performed by the Aarakshak recognition API.',
  },
  rekognition: {
    provider: 'aws-rekognition',
    modelVersion: 'rekognition-compare-faces',
    biometric: true,
    note: 'Face comparison performed by AWS Rekognition CompareFaces (fallback tier).',
  },
  heuristic: {
    provider: 'local-heuristic',
    modelVersion: 'heuristic-2026-07',
    biometric: false,
    note: 'Non-biometric workflow scorer. No face comparison was performed.',
  },
  none: {
    provider: 'none',
    modelVersion: null,
    biometric: false,
    note: 'No photo supplied, so no comparison was attempted.',
  },
};

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Which photo is the source and which the target of a comparison.
 *
 * The sighting photo is always the source and the case photo the target,
 * whichever of the two records arrived first. A pair therefore scores the same
 * whether a sighting found the case or a newly registered case found the
 * sighting, and the forward and reverse searches share one set of thresholds.
 */
export function orient(direction, probeBuf, storedBuf) {
  return direction === 'reverse' ? [storedBuf, probeBuf] : [probeBuf, storedBuf];
}

const ANSWER_STATUSES = new Set(['answered', 'no_face', 'no_answer', 'unsupported_format', 'too_large', 'not_configured', 'not_asked']);

/** Coerces whatever a provider wrapper returned into a normalised answer. */
export function answer(value) {
  if (!value || typeof value !== 'object') return { status: 'no_answer' };
  if (!ANSWER_STATUSES.has(value.status)) return { status: 'no_answer' };
  if (value.status === 'answered' && !Number.isFinite(Number(value.score))) return { status: 'no_answer' };
  return value;
}

const statusOf = (a) => a?.status || 'not_asked';

/** The per-candidate record of which engines answered, and how. */
function engineRecord(aarakshak, rekognition) {
  const engines = { aarakshak: statusOf(aarakshak), rekognition: statusOf(rekognition) };
  return {
    engines,
    enginesAnswered: Object.entries(engines).filter(([, s]) => s === 'answered').map(([name]) => name),
  };
}

function rounded(value) {
  return Number(Math.max(0, Math.min(1, Number(value) || 0)).toFixed(3));
}

/**
 * Step 1b of comparePhotos: compares the other photo pairs of the records
 * most like the probe, and moves each record's row to its best answered pair.
 * Mutates `rows`. Returns how many pairs were compared and what they found.
 *
 * A record's other photos are read only for the pairs the budget lets run,
 * and no new pair is started after `deadline` (a time in ms): the person who
 * sent a sighting is waiting on the answer.
 */
async function compareOtherPairs({ rows, photoBuf, probeId, probeExtras, direction, aarakshak, concurrency, budget, deadline = Infinity, now = () => Date.now() }) {
  const none = { compared: 0, answered: 0, improved: 0, stoppedForTime: 0 };
  const limit = Math.max(0, Math.floor(Number(budget) || 0));
  const probes = [{ id: probeId, buffer: photoBuf }, ...(Array.isArray(probeExtras) ? probeExtras : []).filter((p) => p?.buffer?.length)];
  const hasExtras = (row) => typeof row.extras === 'function' || (Array.isArray(row.extras) && row.extras.length > 0);
  if (!limit || (!rows.some(hasExtras) && probes.length < 2)) return none;

  // The best five by their first pair, then those whose first pair found no
  // face (the record's other photos, or the probe's, may show one).
  const shortlist = [
    ...rows.filter((row) => row.aarakshak.status === 'answered').sort((a, b) => b.aarakshak.score - a.aarakshak.score).slice(0, MAX_MATCH_CANDIDATES),
    ...rows.filter((row) => row.aarakshak.status === 'no_face').slice(0, MAX_MATCH_CANDIDATES),
  ];
  if (!shortlist.length) return none;

  // Each shortlisted record's photos, as descriptors: `{ id, buffer }` in
  // hand, or `{ id, load() }` read only if one of its pairs is spent.
  const targetsOf = await mapLimit(shortlist, concurrency, async (row) => {
    let extras = row.extras;
    try {
      if (typeof extras === 'function') extras = await extras();
    } catch {
      extras = [];
    }
    const others = (Array.isArray(extras) ? extras : [])
      .filter((p) => p && p.id !== row.targetId && (p.buffer?.length || typeof p.load === 'function'));
    return [{ id: row.targetId, buffer: row.targetBuf }, ...others];
  });

  // Every pair not yet compared, per record; then one pair per record a
  // round, in the shortlist's order, so the best five get their next pair
  // before any gets two.
  const queues = shortlist.map((row, i) => {
    const queue = [];
    for (const target of targetsOf[i]) {
      for (const probe of probes) {
        if (probe.id === probeId && target.id === row.targetId) continue;
        queue.push({ row, probe, target });
      }
    }
    return queue;
  });
  const spend = [];
  for (let round = 0; spend.length < limit && queues.some((q) => q.length > round); round += 1) {
    for (const queue of queues) {
      if (spend.length >= limit) break;
      if (queue[round]) spend.push(queue[round]);
    }
  }
  if (!spend.length || now() > deadline) return { ...none, stoppedForTime: now() > deadline ? spend.length : 0 };

  // Only the photos those pairs need are read, each once.
  const toRead = [...new Set(spend.map((item) => item.target).filter((target) => !target.buffer?.length && typeof target.load === 'function'))];
  await mapLimit(toRead, concurrency, async (target) => {
    try {
      target.buffer = await target.load();
    } catch {
      target.buffer = null;
    }
  });
  const ready = spend.filter((item) => item.target.buffer?.length);

  let stoppedForTime = 0;
  const results = await mapLimit(ready, concurrency, async (item) => {
    if (now() > deadline) {
      stoppedForTime += 1;
      return { status: 'not_asked' };
    }
    return answer(await aarakshak.compare(...orient(direction, item.probe.buffer, item.target.buffer)));
  });
  let answeredCount = 0;
  const improvedRows = new Set();
  results.forEach((result, i) => {
    if (result.status !== 'answered') return;
    answeredCount += 1;
    const { row, probe, target } = ready[i];
    if (row.aarakshak.status === 'answered' && row.aarakshak.score >= result.score) return;
    row.aarakshak = result;
    row.buffers = orient(direction, probe.buffer, target.buffer);
    row.pair = photoPairOf(direction, probe.id, target.id);
    improvedRows.add(row);
  });
  return { compared: ready.length - stoppedForTime, answered: answeredCount, improved: improvedRows.size, stoppedForTime };
}

/**
 * The most extra photo pairs one search compares, by default, beyond the one
 * pair per record it always compares (KHOZO_EXTRA_PAIR_BUDGET). Each is a paid
 * Aarakshak call; twenty is four more rounds for five cases.
 */
export const EXTRA_PAIR_BUDGET = 20;

/**
 * How long the extra photo pairs may go on being started, by default,
 * counted from when they begin (after every record's first pair). The phone
 * gives up on a sighting at 45 s; the screen, the first pairs, a pair already
 * running and the second opinion need the rest.
 */
export const EXTRA_PAIR_TIME_MS = 10000;

/** KHOZO_EXTRA_PAIR_BUDGET as read: a number of pairs, 0 to compare no other pair. */
export function extraPairBudgetOf(value) {
  if (value == null || value === '') return EXTRA_PAIR_BUDGET;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : EXTRA_PAIR_BUDGET;
}

/**
 * The records of a search as comparePhotos takes them: each one's lead photo
 * (shared/photo-set.js leadPhotoOf) read now, its other photos described and
 * read only if a pair of them is compared. A photo whose own check found no
 * face is never compared; a case's group photo neither, going forward (the
 * records are cases): a relative beside the child would be matched as the
 * child. A sighting's group photo stays: the child may be in it. A record
 * whose lead photo cannot be read is left out, as one whose only photo could
 * not be read always was.
 */
export async function loadComparable(stored, readPhoto, concurrency, { direction = 'forward' } = {}) {
  const loaded = await mapLimit(stored, concurrency, async (report) => {
    const lead = leadPhotoOf(report) || { id: MAIN_PHOTO, file: report.photoFile };
    const targetBuf = lead.file ? await readPhoto(lead.file) : null;
    const others = photoCountOf(report) > 1
      ? photosOf(report)
        .filter((p) => p.id !== lead.id)
        .filter((p) => p.check?.verdict !== 'no_face' && !(direction === 'forward' && isBadFacePhoto(p)))
        .map((p) => ({ id: p.id, load: () => readPhoto(p.file) }))
      : [];
    return { report, targetId: lead.id, targetBuf, extras: others.length ? others : null };
  });
  return loaded.filter((row) => row.targetBuf);
}

/**
 * Which of a record's photos was compared, by shared/photo-set.js id, oriented
 * as a sighting and a case: the probe is the sighting going forward and the
 * case in reverse (orient).
 */
function photoPairOf(direction, probeId, targetId) {
  return direction === 'reverse'
    ? { sighting: targetId, case: probeId }
    : { sighting: probeId, case: targetId };
}

/**
 * Compares a probe photo with each loaded record.
 *
 * `comparable` is `[{ report, targetBuf, targetId?, extras? }]`. `providers.aarakshak` and
 * `providers.rekognition` are `{ ready, compare(sourceBuf, targetBuf) }`, with
 * `compare` resolving to a normalised answer. Returns the candidates (best
 * first, at most five, each carrying its record under `report`) and a summary
 * of what answered.
 *
 * Several photos (shared/photo-set.js). `photoBuf` is the probe's lead photo
 * (`probeId`) and `targetBuf` each record's (`targetId`); every record is
 * compared on that one pair, as it always was. Then the records most like the
 * probe - the best five, and those whose pair found no face - are compared on
 * their other pairs (`probeExtras` against each record's `extras()`), one more
 * pair per record a round, best first, until `extraPairBudget` pairs have been
 * spent. Each record keeps its best pair, and the second opinion and every
 * count after that see one pair per record, exactly as before. A probe and
 * records with one photo each cost nothing more.
 */
export async function comparePhotos({
  photoBuf,
  probeId = 'main',
  probeExtras = [],
  comparable,
  direction = 'forward',
  providers,
  confirmThreshold = 0.8,
  secondOpinionTopN = MAX_MATCH_CANDIDATES,
  concurrency = 5,
  extraPairBudget = EXTRA_PAIR_BUDGET,
  extraPairTimeMs = EXTRA_PAIR_TIME_MS,
  now = () => Date.now(),
}) {
  const { aarakshak, rekognition } = providers;
  const pairs = comparable.map(({ report, targetBuf, targetId = 'main', extras = null }) => ({
    report,
    buffers: orient(direction, photoBuf, targetBuf),
    targetBuf,
    targetId,
    extras,
    pair: photoPairOf(direction, probeId, targetId),
  }));

  // 1. Aarakshak, on every record's one pair.
  const first = aarakshak.ready
    ? await mapLimit(pairs, concurrency, async (pair) => answer(await aarakshak.compare(...pair.buffers)))
    : pairs.map(() => ({ status: 'not_configured' }));
  const rows = pairs.map((pair, i) => ({ ...pair, aarakshak: first[i] }));

  // 1b. The other photo pairs of the records most like the probe, given
  // their own time from now.
  const deadline = now() + Math.max(0, Number(extraPairTimeMs) || 0);
  const extraPairs = aarakshak.ready
    ? await compareOtherPairs({ rows, photoBuf, probeId, probeExtras, direction, aarakshak, concurrency, budget: extraPairBudget, deadline, now })
    : { compared: 0, answered: 0, improved: 0, stoppedForTime: 0 };

  const answered = [];
  const unanswered = [];
  for (const row of rows) (row.aarakshak.status === 'answered' ? answered : unanswered).push(row);

  // 2. Rekognition's second opinion on Aarakshak's best five.
  const proposals = answered
    .slice()
    .sort((a, b) => b.aarakshak.score - a.aarakshak.score)
    .slice(0, MAX_MATCH_CANDIDATES);
  const topN = Math.max(0, Number(secondOpinionTopN) || 0);
  const reviewed = await mapLimit(proposals, concurrency, async (row, index) => {
    if (!rekognition.ready) return { ...row, rekognition: { status: 'not_configured' } };
    if (index >= topN) return { ...row, rekognition: { status: 'not_asked' } };
    return { ...row, rekognition: answer(await rekognition.compare(...row.buffers)) };
  });

  // 3. Rekognition alone on the pairs Aarakshak could not answer for.
  const alone = rekognition.ready && unanswered.length
    ? await mapLimit(unanswered, concurrency, async (row) => ({ ...row, rekognition: answer(await rekognition.compare(...row.buffers)) }))
    : unanswered.map((row) => ({ ...row, rekognition: { status: rekognition.ready ? 'not_asked' : 'not_configured' } }));

  const candidates = [];
  const secondOpinion = { checked: 0, confirmed: 0, withheld: 0, notChecked: 0 };

  for (const row of reviewed) {
    const a = row.aarakshak;
    const r = row.rekognition;
    const base = {
      report: row.report,
      photoPair: row.pair,
      primaryScore: rounded(a.score),
      band: a.band || null,
      sourceFaces: a.sourceFaces ?? null,
      targetFaces: a.targetFaces ?? null,
      sourceQuality: a.sourceQuality ?? null,
      targetQuality: a.targetQuality ?? null,
      warnings: [...new Set(a.warnings || [])],
      lowQuality: Boolean(a.lowQuality),
      ...engineRecord(a, r),
    };
    if (r.status === 'answered') {
      secondOpinion.checked += 1;
      const second = rounded(r.score);
      const agrees = second >= confirmThreshold;
      if (!agrees) {
        // Two engines looked and did not agree: withheld, because the number
        // is what an officer acts on.
        secondOpinion.withheld += 1;
        continue;
      }
      secondOpinion.confirmed += 1;
      candidates.push({
        ...base,
        score: Math.min(base.primaryScore, second),
        secondOpinionScore: second,
        secondOpinionProvider: ENGINES.rekognition.provider,
        secondOpinion: 'agrees',
        corroborated: true,
        confirmed: true,
        notChecked: false,
        enginesDisagree: Math.abs(base.primaryScore - second) >= DISAGREEMENT_GAP,
      });
    } else if (r.status === 'not_configured' || r.status === 'not_asked') {
      candidates.push({
        ...base,
        score: base.primaryScore,
        secondOpinionScore: null,
        secondOpinionProvider: null,
        secondOpinion: r.status === 'not_configured' ? 'unavailable' : 'not_asked',
        corroborated: false,
        confirmed: false,
        notChecked: false,
        enginesDisagree: null,
      });
    } else {
      // Configured, asked, and no answer came back.
      secondOpinion.notChecked += 1;
      candidates.push({
        ...base,
        score: base.primaryScore,
        secondOpinionScore: null,
        secondOpinionProvider: ENGINES.rekognition.provider,
        secondOpinion: 'not_checked',
        notCheckedReason: r.status,
        corroborated: false,
        confirmed: false,
        notChecked: true,
        enginesDisagree: null,
      });
    }
  }

  let rekognitionAlone = 0;
  for (const row of alone) {
    const r = row.rekognition;
    if (r.status !== 'answered') continue;
    rekognitionAlone += 1;
    const score = rounded(r.score);
    if (score < confirmThreshold) continue;
    candidates.push({
      report: row.report,
      photoPair: row.pair,
      score,
      primaryScore: null,
      secondOpinionScore: score,
      secondOpinionProvider: ENGINES.rekognition.provider,
      secondOpinion: 'sole_engine',
      corroborated: false,
      confirmed: true,
      notChecked: false,
      enginesDisagree: null,
      band: null,
      sourceFaces: r.sourceFaces ?? null,
      targetFaces: r.targetFaces ?? null,
      sourceQuality: null,
      targetQuality: null,
      warnings: [...new Set([...(row.aarakshak.warnings || []), ...(r.warnings || [])])],
      lowQuality: false,
      aarakshakStatus: row.aarakshak.status,
      ...engineRecord(row.aarakshak, r),
    });
  }

  // Two engines agreeing outranks one engine alone, then the score.
  candidates.sort((x, y) => Number(y.corroborated) - Number(x.corroborated) || y.score - x.score);

  const answeredReports = [
    ...answered.map((row) => row.report),
    ...alone.filter((row) => row.rekognition.status === 'answered').map((row) => row.report),
  ];
  // Every pair was looked at and no engine found a face in it: a different
  // answer from "nothing answered", and the reviewer is told which.
  const loneStatus = new Map(alone.map((row) => [row.report, row.rekognition.status]));
  // Pairs no engine answered for and no engine found "no face" in: a fault,
  // not an answer. A search with any is worth running again (the re-match
  // batch); a case photo with no face in it is not. One row per record, its
  // best pair (1b).
  const answeredSet = new Set(answeredReports);
  const failedPairs = rows.filter((row) => {
    if (answeredSet.has(row.report)) return false;
    return ![row.aarakshak.status, loneStatus.get(row.report)].includes('no_face');
  }).length;
  const noFaceEverywhere =
    rows.length > 0 &&
    !answeredReports.length &&
    rows.every((row) => {
      const statuses = [row.aarakshak.status, loneStatus.get(row.report)].filter(Boolean);
      return statuses.includes('no_face') && statuses.every((s) => ['no_face', 'not_configured', 'not_asked'].includes(s));
    });

  return {
    candidates: candidates.slice(0, MAX_MATCH_CANDIDATES),
    summary: {
      comparedAgainst: answeredReports.length,
      comparedIds: answeredReports.map((r) => r.id).filter(Boolean),
      failedPairs,
      aarakshakAnswered: answered.length,
      rekognitionAlone,
      secondOpinion,
      disagreements: candidates.filter((c) => c.enginesDisagree).length,
      noFace: noFaceEverywhere,
      // The other photo pairs compared (1b), and how many found a better
      // pair than the records' first one.
      extraPairs: { ...extraPairs, budget: Math.max(0, Number(extraPairBudget) || 0) },
      // The sighting photo is always the source (orient), whichever direction.
      sightingQuality: proposals[0]?.aarakshak?.sourceQuality ?? null,
      qualityWarnings: [...new Set(answered.flatMap((row) => row.aarakshak.warnings || []))],
    },
  };
}

/**
 * The engine description returned with every search, whichever way it went.
 * `settings` (shared/match-config.js engineSettings) travel with it, so the
 * result can be stored with the thresholds and configuration it was produced
 * under.
 */
export function rankResult({ outcome, pool, settings, started, rekognitionReady, confirmThreshold, aarakshakThreshold, noun, storedCount }) {
  const thresholds = thresholdsOf(settings);
  if (outcome && outcome.summary.comparedAgainst > 0) {
    const s = outcome.summary;
    const viaAarakshak = s.aarakshakAnswered > 0;
    const tier = viaAarakshak ? ENGINES.aarakshak : ENGINES.rekognition;
    return {
      candidates: outcome.candidates,
      engine: {
        ...tier,
        // The comparisons that actually answered, not the ones attempted: a
        // call that timed out compared nothing, and an officer reading
        // "compared against 25" must be able to trust it.
        comparedAgainst: s.comparedAgainst,
        comparedIds: s.comparedIds,
        failedPairs: s.failedPairs,
        aarakshakAnswered: s.aarakshakAnswered,
        rekognitionAlone: s.rekognitionAlone,
        pool,
        threshold: viaAarakshak ? Number(aarakshakThreshold) : confirmThreshold,
        thresholds,
        settings,
        elapsedMs: Date.now() - started,
        corroborated: s.secondOpinion.checked > 0,
        secondOpinion: rekognitionReady
          ? {
              provider: ENGINES.rekognition.provider,
              checked: s.secondOpinion.checked,
              confirmed: s.secondOpinion.confirmed,
              withheld: s.secondOpinion.withheld,
              notChecked: s.secondOpinion.notChecked,
              threshold: confirmThreshold,
            }
          : null,
        disagreements: s.disagreements,
        sightingQuality: s.sightingQuality,
        qualityWarnings: s.qualityWarnings,
        // The other photo pairs compared beside each record's first one.
        extraPairs: s.extraPairs || null,
        ...(!viaAarakshak && !outcome.candidates.length
          ? { note: `Compared against ${s.comparedAgainst} ${noun}${s.comparedAgainst === 1 ? '' : 's'}; none reached the confirmation threshold.` }
          : {}),
      },
    };
  }

  // Nothing biometric answered. No candidate is returned: there is no honest
  // way to rank faces without comparing faces, and a number invented here is
  // one an officer would act on.
  const noFace = Boolean(outcome?.summary?.noFace);
  return {
    candidates: [],
    engine: {
      ...ENGINES.heuristic,
      comparedAgainst: 0,
      comparedIds: [],
      pool,
      thresholds,
      settings,
      noFace,
      reason: !storedCount
        ? `No stored ${noun === 'open case' ? 'case' : 'sighting'} photos to compare against, so no face comparison was possible.`
        : noFace
          ? 'No face could be found in the photo by any engine, so no face comparison was possible.'
          : 'No biometric provider answered, so no face comparison was made and no candidate is offered.',
    },
  };
}

/**
 * Decides whether a photo shows a person, and how many.
 *
 * Probes the image against itself: each provider reports the faces it found.
 * Aarakshak first; when it finds no face, Rekognition is asked too, so one
 * engine's "nobody there" does not hide a real sighting from the general
 * alert. Three verdicts, and callers treat the last two the same way:
 *   person      a face was found (`faces` says how many)
 *   no_person   every engine that looked found none
 *   unverified  no engine answered
 */
export async function screenPhoto(photoBuf, { aarakshak, rekognition }) {
  const checkedAt = Date.now();
  if (!photoBuf?.length) return { verdict: 'no_photo', faces: 0, provider: null, checkedAt };

  let aarakshakLooked = null;
  if (aarakshak.ready) {
    const probe = answer(await aarakshak.compare(photoBuf, photoBuf));
    if (probe.status === 'answered' && (probe.sourceFaces || 0) > 0) {
      const found = {
        verdict: 'person',
        faces: probe.sourceFaces,
        quality: probe.sourceQuality ?? null,
        warnings: probe.warnings || [],
        provider: ENGINES.aarakshak.provider,
        checkedAt,
      };
      if (!isWeakFace(found)) return { ...found, clearFace: true };
      // Aarakshak's only face is one it calls small or unclear — often a
      // passer-by in the background of a photo of something else. A second
      // engine, when there is one, decides whether the photo shows a person;
      // without one, it does not count as one (shared/face-screen.js).
      if (rekognition.ready) {
        const second = answer(await rekognition.compare(photoBuf, photoBuf));
        const faces = second.status === 'answered' ? Math.max(second.targetFaces || 0, second.sourceFaces || 0) : 0;
        return {
          ...found,
          clearFace: faces > 0,
          secondEngine: { provider: ENGINES.rekognition.provider, status: second.status, faces },
        };
      }
      return { ...found, clearFace: false };
    }
    if (probe.status === 'answered' || probe.status === 'no_face') aarakshakLooked = probe;
  }

  if (rekognition.ready) {
    const probe = answer(await rekognition.compare(photoBuf, photoBuf));
    if (probe.status === 'answered') {
      const faces = Math.max(probe.targetFaces || 0, probe.sourceFaces || 0);
      return {
        verdict: faces > 0 ? 'person' : 'no_person',
        faces,
        warnings: probe.warnings || [],
        provider: ENGINES.rekognition.provider,
        ...(aarakshakLooked ? { firstEngine: { provider: ENGINES.aarakshak.provider, faces: 0 } } : {}),
        checkedAt,
      };
    }
    if (probe.status === 'no_face') {
      return { verdict: 'no_person', faces: 0, warnings: probe.warnings || [], provider: ENGINES.rekognition.provider, checkedAt };
    }
  }

  if (aarakshakLooked) {
    return {
      verdict: 'no_person',
      faces: 0,
      quality: aarakshakLooked.sourceQuality ?? null,
      warnings: aarakshakLooked.warnings || [],
      provider: ENGINES.aarakshak.provider,
      checkedAt,
    };
  }

  return {
    verdict: 'unverified',
    faces: null,
    provider: null,
    reason: 'No face-detection provider answered; the photo has not been screened.',
    checkedAt,
  };
}
