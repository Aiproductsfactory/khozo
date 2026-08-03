// Face-match provider boundary.
//
// Tiering: Aarakshak (primary) -> AWS Rekognition (fallback) -> local heuristic.
// Each tier is attempted only when it is actually configured, and the engine
// reported back to callers names the tier that really produced the scores. The
// dashboard surfaces that value, so it must never claim biometric matching that
// did not happen.

import { listReports, readPhoto } from './store.js';
import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';

// Credentials come from the environment only. A key committed to the repo ends up
// in every clone, CI log and built artefact, and cannot be rotated independently.
const AARAKSHAK_API_URL = process.env.AARAKSHAK_API_URL || 'https://aarakshak.com/api/v1/compare';
const AARAKSHAK_API_KEY = process.env.AARAKSHAK_API_KEY || '';
const AARAKSHAK_TIMEOUT_MS = Number(process.env.AARAKSHAK_TIMEOUT_MS || 20000);

/**
 * Threshold sent to Aarakshak.
 *
 * Deliberately far below the provider's 0.82 default. Measured against pairs of
 * real photographs, genuine same-person matches scored 0.48-0.86 while different
 * people scored -0.04-0.07; at 0.82 five of six true matches were rejected.
 *
 * Khozo does not auto-decide anything - a score only decides whether an officer
 * is shown a candidate - so a missed child is a far worse error than an extra
 * face to review. The provider's own `match` flag is ignored for that reason;
 * ranking uses the raw score and KhOZO's own bands.
 */
const AARAKSHAK_THRESHOLD = process.env.AARAKSHAK_THRESHOLD || '0.35';

// How many still-missing cases a single sighting is compared against. Each
// comparison is a network call, so this bounds both latency and spend.
const MAX_CANDIDATES = Number(process.env.KHOZO_MATCH_CANDIDATES || 25);

// Comparisons run concurrently: a single call takes ~1.8s, so 25 sequential
// calls would leave a field reporter staring at a spinner for 45 seconds.
const MATCH_CONCURRENCY = Number(process.env.KHOZO_MATCH_CONCURRENCY || 5);

/**
 * How many of Aarakshak's top candidates get a second opinion from Rekognition.
 *
 * Rekognition is not only a failure fallback. Two face models fail on different
 * images - pose, lighting, and above all the age gap between a registration
 * photo and a sighting years later - so a case one model misses the other may
 * still recognise. Re-scoring only the shortlist keeps that recall benefit at
 * N + 5 calls instead of doubling every comparison.
 *
 * Set to 0 to disable and use Rekognition purely as a failure fallback.
 */
const SECOND_OPINION_TOP_N = Number(process.env.KHOZO_SECOND_OPINION_TOP_N || 5);

/** Score gap at which the two engines are considered to disagree. */
const DISAGREEMENT_GAP = 0.25;

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-south-1';
let rekognitionClient = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  try {
    rekognitionClient = new RekognitionClient({ region: awsRegion });
  } catch (err) {
    console.warn('[MatchEngine] AWS Rekognition client initialization warning:', err.message);
  }
}

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

/** Which tiers are configured. Surfaced on the readiness dashboard. */
export function matchEngineInfo() {
  const aarakshakReady = Boolean(AARAKSHAK_API_KEY);
  const rekognitionReady = Boolean(rekognitionClient);
  const active = aarakshakReady ? ENGINES.aarakshak : rekognitionReady ? ENGINES.rekognition : ENGINES.heuristic;
  return {
    ...active,
    aarakshakConfigured: aarakshakReady,
    rekognitionConfigured: rekognitionReady,
    fallbackProvider: aarakshakReady && rekognitionReady ? ENGINES.rekognition.provider : ENGINES.heuristic.provider,
    note: aarakshakReady || rekognitionReady
      ? active.note
      : 'No biometric provider is configured. Set AARAKSHAK_API_KEY or AWS credentials to enable face comparison.',
  };
}

// ---- Tier 3: local heuristic ----------------------------------------------

/** Stable seed derived from the photo bytes, so scoring is deterministic. */
function hashUnit(buf) {
  let h = 2166136261;
  for (let i = 0; i < buf.length; i += 997) {
    h ^= buf[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function scoreCandidateLocal(seedUnit, report, hints) {
  let score = 0.45 + seedUnit * 0.5;
  if (hints?.gender && report.gender && hints.gender === report.gender) score += 0.04;
  if (hints?.ageApprox != null && report.age != null) {
    const diff = Math.abs(Number(hints.ageApprox) - report.age);
    score += Math.max(0, 0.06 - diff * 0.02);
  }
  if (report.status === 'found') score -= 0.5;
  const jitter = hashUnit(Buffer.from(report.id)) * 0.18;
  return Math.max(0, Math.min(0.99, score - 0.09 + jitter * (1 - seedUnit)));
}

function rankWithHeuristic(photoBuf, candidates, hints = {}) {
  const seed = hashUnit(photoBuf);
  return candidates
    .map((report) => ({ report, score: Number(scoreCandidateLocal(seed, report, hints).toFixed(2)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ---- Tier 1: Aarakshak -----------------------------------------------------

/**
 * Compares two images with the Aarakshak API.
 *
 * Returns a 0..1 similarity, or null when the provider could not answer - null
 * means "try the next tier", which is different from a confident low score.
 */
async function compareFacesAarakshak(sourceBuf, targetBuf, attempt = 0) {
  if (!AARAKSHAK_API_KEY || !sourceBuf || !targetBuf) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AARAKSHAK_TIMEOUT_MS);
  try {
    const formData = new FormData();
    formData.append('source_image', new Blob([sourceBuf], { type: 'image/jpeg' }), 'source.jpg');
    formData.append('target_image', new Blob([targetBuf], { type: 'image/jpeg' }), 'target.jpg');
    formData.append('threshold', AARAKSHAK_THRESHOLD);

    const res = await fetch(AARAKSHAK_API_URL, {
      method: 'POST',
      headers: { 'X-API-Key': AARAKSHAK_API_KEY },
      body: formData,
      signal: controller.signal,
    });

    // 4xx is a decision (bad key, unusable image); only retry transient faults.
    if (!res.ok) {
      if (res.status >= 500 && attempt === 0) {
        clearTimeout(timer);
        return compareFacesAarakshak(sourceBuf, targetBuf, attempt + 1);
      }
      if (res.status === 401 || res.status === 403) {
        console.warn('[MatchEngine] Aarakshak rejected the API key — check AARAKSHAK_API_KEY.');
      }
      return null;
    }

    const data = await res.json();
    const raw = data.score ?? data.similarity ?? data.match_confidence;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;

    // Scores for clearly different faces come back slightly negative, so clamp
    // rather than pass a negative similarity into ranking.
    const score = Number(Math.max(0, Math.min(1, raw)).toFixed(3));

    // The provider reports per-image capture quality. Surfacing it lets a
    // reviewer tell "no match" apart from "the photo was too poor to tell".
    const warnings = [
      ...(data.source_quality?.warnings || []),
      ...(data.target_quality?.warnings || []),
    ];
    return {
      score,
      band: data.decision_band || null,
      sourceFaces: data.source_faces?.length ?? 0,
      targetFaces: data.target_faces?.length ?? 0,
      sourceQuality: data.source_quality_score ?? null,
      targetQuality: data.target_quality_score ?? null,
      warnings: [...new Set(warnings)],
      lowQuality: data.target_quality?.recommendation === 'retake_or_manual_review',
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    if (!aborted && attempt === 0) {
      clearTimeout(timer);
      return compareFacesAarakshak(sourceBuf, targetBuf, attempt + 1);
    }
    console.warn(`[MatchEngine] Aarakshak comparison failed${aborted ? ' (timeout)' : ''}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Tier 2: AWS Rekognition ----------------------------------------------

async function compareFacesAWS(sourceBuf, targetBuf) {
  if (!rekognitionClient || !sourceBuf || !targetBuf) return null;
  try {
    const res = await rekognitionClient.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: sourceBuf },
        TargetImage: { Bytes: targetBuf },
        // Low threshold: ranking is done here, and the officer makes the call.
        SimilarityThreshold: 1,
      }),
    );
    const best = res.FaceMatches?.[0];
    // An empty match list is a real answer ("no similar face"), not a failure.
    return {
      score: best ? Number((best.Similarity / 100).toFixed(3)) : 0.05,
      sourceFaces: best ? 1 : 0,
      targetFaces: res.FaceMatches?.length ?? 0,
      warnings: [],
    };
  } catch (err) {
    // A face-not-detected error is a legitimate "no match" for this candidate.
    if (err?.name === 'InvalidParameterException') return { score: 0, sourceFaces: 0, targetFaces: 0, warnings: ['no_face_detected'] };
    console.warn('[MatchEngine] AWS Rekognition comparison failed:', err.message);
    return null;
  }
}

// ---- Orchestration ---------------------------------------------------------

/**
 * Runs one tier across every candidate.
 *
 * A tier counts as working only if it answered for at least one candidate;
 * otherwise the caller falls through to the next tier.
 */
async function rankWithProvider(compare, photoBuf, candidates) {
  // Photo reads hit the database, so fetch them concurrently rather than
  // serialising a round trip per candidate.
  const loaded = await mapLimit(candidates, MATCH_CONCURRENCY, async (report) => ({
    report,
    targetBuf: await readPhoto(report.photoFile),
  }));
  const comparable = loaded.filter((row) => row.targetBuf);
  if (!comparable.length) return null;

  const compared = await mapLimit(comparable, MATCH_CONCURRENCY, async ({ report, targetBuf }) => {
    const result = await compare(photoBuf, targetBuf);
    return result === null ? null : { report, ...result };
  });

  const answered = compared.filter(Boolean);
  // A tier that could not answer for any candidate has not "found no match" -
  // it has failed, and the next tier should get a turn.
  if (!answered.length) return null;

  return answered.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Re-scores the strongest candidates with the secondary engine.
 *
 * Ranking then uses the higher of the two scores: if either model recognises
 * the child, an officer should see that case. Where the models disagree sharply
 * the candidate is flagged rather than silently averaged, because "one engine is
 * confident and the other is not" is exactly the situation a human should look at.
 */
async function addSecondOpinion(photoBuf, ranked) {
  if (!rekognitionClient || SECOND_OPINION_TOP_N <= 0 || !ranked.length) {
    return { candidates: ranked, applied: false, checked: 0 };
  }

  const shortlist = ranked.slice(0, SECOND_OPINION_TOP_N);
  let checked = 0;

  const reviewed = await mapLimit(shortlist, MATCH_CONCURRENCY, async (candidate) => {
    const targetBuf = await readPhoto(candidate.report.photoFile);
    if (!targetBuf) return candidate;
    const second = await compareFacesAWS(photoBuf, targetBuf);
    if (!second) return candidate;
    checked += 1;
    const primary = candidate.score;
    return {
      ...candidate,
      primaryScore: primary,
      secondOpinionScore: second.score,
      secondOpinionProvider: ENGINES.rekognition.provider,
      score: Math.max(primary, second.score),
      enginesDisagree: Math.abs(primary - second.score) >= DISAGREEMENT_GAP,
    };
  });

  const merged = [...reviewed, ...ranked.slice(SECOND_OPINION_TOP_N)].sort((a, b) => b.score - a.score);
  return { candidates: merged, applied: checked > 0, checked };
}

/**
 * Ranks still-missing children against an uploaded sighting photo.
 *
 * @param {Buffer} photoBuf
 * @param {{gender?:string, ageApprox?:number}} hints
 * @returns {Promise<{candidates:{report:any, score:number}[], engine:object}>}
 */
export async function rankMatches(photoBuf, hints = {}) {
  if (!photoBuf?.length) {
    return { candidates: [], engine: { ...ENGINES.none } };
  }

  const openCases = listReports().filter((r) => r.status !== 'found' && !r.anonymizedAt);
  const withPhotos = openCases.filter((r) => r.photoFile).slice(0, MAX_CANDIDATES);

  if (withPhotos.length) {
    const started = Date.now();
    const viaAarakshak = await rankWithProvider(compareFacesAarakshak, photoBuf, withPhotos);
    if (viaAarakshak?.length) {
      const second = await addSecondOpinion(photoBuf, viaAarakshak);
      return {
        candidates: second.candidates,
        engine: {
          ...ENGINES.aarakshak,
          comparedAgainst: withPhotos.length,
          threshold: Number(AARAKSHAK_THRESHOLD),
          elapsedMs: Date.now() - started,
          secondOpinion: second.applied
            ? { provider: ENGINES.rekognition.provider, checked: second.checked }
            : null,
          disagreements: second.candidates.filter((c) => c.enginesDisagree).length,
          // If the sighting photo itself was poor, every score is unreliable -
          // the reviewer needs to know that before trusting a low result.
          sightingQuality: viaAarakshak[0]?.sourceQuality ?? null,
          qualityWarnings: [...new Set(viaAarakshak.flatMap((c) => c.warnings || []))],
        },
      };
    }

    const viaRekognition = await rankWithProvider(compareFacesAWS, photoBuf, withPhotos);
    if (viaRekognition?.length) {
      return {
        candidates: viaRekognition,
        engine: { ...ENGINES.rekognition, comparedAgainst: withPhotos.length, elapsedMs: Date.now() - started },
      };
    }
  }

  // Nothing biometric was available or usable. Say so plainly rather than
  // presenting heuristic output as a face match.
  return {
    candidates: rankWithHeuristic(photoBuf, openCases.slice(0, MAX_CANDIDATES), hints),
    engine: {
      ...ENGINES.heuristic,
      comparedAgainst: 0,
      reason: withPhotos.length
        ? 'No biometric provider answered; scores are non-biometric.'
        : 'No stored case photos to compare against; scores are non-biometric.',
    },
  };
}
