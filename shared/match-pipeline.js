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
 * Compares a probe photo with each loaded record.
 *
 * `comparable` is `[{ report, targetBuf }]`. `providers.aarakshak` and
 * `providers.rekognition` are `{ ready, compare(sourceBuf, targetBuf) }`, with
 * `compare` resolving to a normalised answer. Returns the candidates (best
 * first, at most five, each carrying its record under `report`) and a summary
 * of what answered.
 */
export async function comparePhotos({
  photoBuf,
  comparable,
  direction = 'forward',
  providers,
  confirmThreshold = 0.8,
  secondOpinionTopN = MAX_MATCH_CANDIDATES,
  concurrency = 5,
}) {
  const { aarakshak, rekognition } = providers;
  const pairs = comparable.map(({ report, targetBuf }) => ({ report, buffers: orient(direction, photoBuf, targetBuf) }));

  // 1. Aarakshak, on every pair.
  const first = aarakshak.ready
    ? await mapLimit(pairs, concurrency, async (pair) => answer(await aarakshak.compare(...pair.buffers)))
    : pairs.map(() => ({ status: 'not_configured' }));

  const answered = [];
  const unanswered = [];
  pairs.forEach((pair, i) => {
    const row = { ...pair, aarakshak: first[i] };
    (first[i].status === 'answered' ? answered : unanswered).push(row);
  });

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
  // batch); a case photo with no face in it is not.
  const answeredSet = new Set(answeredReports);
  const failedPairs = pairs.filter((pair, i) => {
    if (answeredSet.has(pair.report)) return false;
    return ![first[i].status, loneStatus.get(pair.report)].includes('no_face');
  }).length;
  const noFaceEverywhere =
    pairs.length > 0 &&
    !answeredReports.length &&
    pairs.every((pair, i) => {
      const statuses = [first[i].status, loneStatus.get(pair.report)].filter(Boolean);
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
