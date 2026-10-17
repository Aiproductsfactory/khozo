// Face-match provider boundary, Node build.
//
// Tiering: Aarakshak (proposes) -> AWS Rekognition (confirms, and compares on
// its own where Aarakshak could not answer) -> no candidate. The rules live in
// shared/match-pipeline.js, which the Cloudflare Worker (worker/src/match.js)
// runs too, so the two runtimes cannot drift; this file supplies only the Node
// way of reaching the two providers. The engine reported back to callers names
// the tier that really produced the scores, and the dashboard surfaces it, so
// it must never claim biometric matching that did not happen.

import { listReports, listFoundReports, readPhoto as readStoredPhoto } from './store.js';
import { selectMatchCandidates, selectSightingCandidates } from '../../shared/match-pool.js';
import { engineSettings } from '../../shared/match-config.js';
import { ENGINES, comparePhotos, mapLimit, rankResult, screenPhoto } from '../../shared/match-pipeline.js';
import { detectImageMime, imageExtension, rekognitionReadable } from '../../shared/photo-format.js';
import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';

export { ENGINES };

const DEFAULT_AARAKSHAK_API_URL = 'https://aarakshak.com/api/v1/compare';

const cleanSecret = (value) => String(value || '').trim();

/**
 * Read per call, not captured at import: credentials come from the
 * environment only (a key committed to the repo ends up in every clone, CI log
 * and built artefact), and reading them when they are used is what lets the
 * engine tests switch providers on and off within one process.
 *
 *   AARAKSHAK_THRESHOLD   sent to Aarakshak. Deliberately far below the
 *                         provider's 0.82 default: measured against real pairs
 *                         of photographs, genuine matches scored 0.48-0.86 and
 *                         different people -0.04-0.07; at 0.82 five of six true
 *                         matches were rejected. Khozo ranks on the raw score.
 *   KHOZO_MATCH_CANDIDATES          open cases one sighting is compared with (25)
 *   KHOZO_REVERSE_MATCH_CANDIDATES  sightings a new case is compared with (50)
 *   KHOZO_MATCH_CONCURRENCY         comparisons in flight (5): one call takes
 *                                   ~1.8s, so 25 sequential calls would leave
 *                                   a reporter at a spinner for 45 seconds
 *   KHOZO_SECOND_OPINION_TOP_N      Aarakshak candidates Rekognition re-scores
 *                                   (5; 0 makes it a pure fallback)
 *   KHOZO_REKOGNITION_CONFIRM       Rekognition similarity that counts as
 *                                   agreement (0.80: AWS's guidance for general
 *                                   face comparison, below their 0.99 identity
 *                                   bar, right here because a human confirms)
 */
function config() {
  const env = process.env;
  const secondOpinion = env.KHOZO_SECOND_OPINION_TOP_N;
  return {
    aarakshakUrl: cleanSecret(env.AARAKSHAK_API_URL) || DEFAULT_AARAKSHAK_API_URL,
    aarakshakKey: cleanSecret(env.AARAKSHAK_API_KEY),
    aarakshakThreshold: String(env.AARAKSHAK_THRESHOLD || '0.35'),
    aarakshakTimeoutMs: Number(env.AARAKSHAK_TIMEOUT_MS || 20000),
    forwardBudget: Number(env.KHOZO_MATCH_CANDIDATES || 25),
    reverseBudget: Number(env.KHOZO_REVERSE_MATCH_CANDIDATES || 50),
    concurrency: Math.max(1, Number(env.KHOZO_MATCH_CONCURRENCY || 5) || 5),
    secondOpinionTopN: secondOpinion === undefined || secondOpinion === '' ? 5 : Math.max(0, Number(secondOpinion) || 0),
    confirmThreshold: Number(env.KHOZO_REKOGNITION_CONFIRM || 0.8),
    rekognitionReady: Boolean(cleanSecret(env.AWS_ACCESS_KEY_ID) && cleanSecret(env.AWS_SECRET_ACCESS_KEY)),
  };
}

let rekognitionClient = null;
let rekognitionClientKey = '';

/** The SDK client for the current credentials, region and endpoint, or null. */
function rekognition() {
  const env = process.env;
  const accessKeyId = cleanSecret(env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = cleanSecret(env.AWS_SECRET_ACCESS_KEY);
  if (!accessKeyId || !secretAccessKey) return null;
  const region = cleanSecret(env.AWS_REGION || env.AWS_DEFAULT_REGION) || 'ap-south-1';
  // KHOZO_REKOGNITION_ENDPOINT points the client at a stand-in for tests;
  // production leaves it unset.
  const endpoint = cleanSecret(env.KHOZO_REKOGNITION_ENDPOINT) || undefined;
  const sessionToken = cleanSecret(env.AWS_SESSION_TOKEN) || undefined;
  const key = [accessKeyId, region, endpoint || ''].join('|');
  if (rekognitionClient && rekognitionClientKey === key) return rekognitionClient;
  try {
    rekognitionClient = new RekognitionClient({
      region,
      ...(endpoint ? { endpoint } : {}),
      credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
    });
    rekognitionClientKey = key;
  } catch (err) {
    console.warn('[MatchEngine] AWS Rekognition client initialization warning:', err.message);
    rekognitionClient = null;
    rekognitionClientKey = '';
  }
  return rekognitionClient;
}

/** The settings a result is stored with (shared/match-config.js). */
function settingsOf(cfg) {
  return engineSettings({
    aarakshakConfigured: Boolean(cfg.aarakshakKey),
    aarakshakModel: ENGINES.aarakshak.modelVersion,
    aarakshakThreshold: cfg.aarakshakThreshold,
    rekognitionConfigured: cfg.rekognitionReady,
    rekognitionModel: ENGINES.rekognition.modelVersion,
    rekognitionConfirm: cfg.confirmThreshold,
    secondOpinionTopN: cfg.secondOpinionTopN,
  });
}

/** Which tiers are configured. Surfaced on the readiness dashboard. */
export function matchEngineInfo() {
  const cfg = config();
  const aarakshakReady = Boolean(cfg.aarakshakKey);
  const rekognitionReady = cfg.rekognitionReady;
  const active = aarakshakReady ? ENGINES.aarakshak : rekognitionReady ? ENGINES.rekognition : ENGINES.heuristic;
  return {
    ...active,
    aarakshakConfigured: aarakshakReady,
    rekognitionConfigured: rekognitionReady,
    fallbackProvider: aarakshakReady && rekognitionReady ? ENGINES.rekognition.provider : ENGINES.heuristic.provider,
    forwardBudget: cfg.forwardBudget,
    reverseBudget: cfg.reverseBudget,
    settings: settingsOf(cfg),
    note: aarakshakReady || rekognitionReady
      ? active.note
      : 'No biometric provider is configured. Set AARAKSHAK_API_KEY or AWS credentials to enable face comparison.',
  };
}

// ---- Aarakshak ---------------------------------------------------------------

/**
 * Compares two images with the Aarakshak API, as a normalised answer
 * (shared/match-pipeline.js). Retries once on a 5xx or a network fault; a 4xx
 * is a decision (bad key, unusable image) and is not retried.
 */
async function compareFacesAarakshak(cfg, sourceBuf, targetBuf, attempt = 0) {
  if (!cfg.aarakshakKey) return { status: 'not_configured' };
  if (!sourceBuf?.length || !targetBuf?.length) return { status: 'no_answer', detail: 'empty image' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.aarakshakTimeoutMs);
  try {
    const formData = new FormData();
    formData.append('source_image', new Blob([sourceBuf], { type: detectImageMime(sourceBuf) || 'image/jpeg' }), `source.${imageExtension(sourceBuf)}`);
    formData.append('target_image', new Blob([targetBuf], { type: detectImageMime(targetBuf) || 'image/jpeg' }), `target.${imageExtension(targetBuf)}`);
    formData.append('threshold', cfg.aarakshakThreshold);

    const res = await fetch(cfg.aarakshakUrl, {
      method: 'POST',
      headers: { 'X-API-Key': cfg.aarakshakKey },
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status >= 500 && attempt === 0) {
        clearTimeout(timer);
        return compareFacesAarakshak(cfg, sourceBuf, targetBuf, attempt + 1);
      }
      const detail = await res.text().catch(() => '');
      // "No detectable face" is an answer about this pair - the engine could
      // not find a face to compare - and the pipeline treats it as unknown,
      // not as a score of 0 (no single-engine veto).
      if (/no detectable face|no_face|comparison_failed/i.test(detail)) {
        return { status: 'no_face', sourceFaces: 0, targetFaces: 0, warnings: ['no_face_detected'] };
      }
      if (res.status === 401 || res.status === 403) {
        console.warn('[MatchEngine] Aarakshak rejected the API key — check AARAKSHAK_API_KEY.');
      } else {
        console.warn(`[MatchEngine] Aarakshak HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
      return { status: 'no_answer', detail: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const raw = data.score ?? data.similarity ?? data.match_confidence;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return { status: 'no_answer', detail: 'no usable score' };
    if ((Array.isArray(data.source_faces) && !data.source_faces.length) || (Array.isArray(data.target_faces) && !data.target_faces.length)) {
      return { status: 'no_face', sourceFaces: data.source_faces?.length ?? 0, targetFaces: data.target_faces?.length ?? 0, warnings: ['no_face_detected'] };
    }

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
      status: 'answered',
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
      return compareFacesAarakshak(cfg, sourceBuf, targetBuf, attempt + 1);
    }
    console.warn(`[MatchEngine] Aarakshak comparison failed${aborted ? ' (timeout)' : ''}:`, err.message);
    return { status: 'no_answer', detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ---- AWS Rekognition ---------------------------------------------------------

/** Rekognition CompareFaces, as a normalised answer. */
async function compareFacesAWS(sourceBuf, targetBuf) {
  const client = rekognition();
  if (!client) return { status: 'not_configured' };
  if (!sourceBuf?.length || !targetBuf?.length) return { status: 'no_answer', detail: 'empty image' };
  // Asked only about images it can read: JPEG or PNG, at most 5 MB. A WebP
  // sent anyway comes back as InvalidParameterException, which reads exactly
  // like "no face in it".
  for (const buf of [sourceBuf, targetBuf]) {
    const readable = rekognitionReadable(buf);
    if (!readable.ok) return { status: readable.reason };
  }
  try {
    const res = await client.send(
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
      status: 'answered',
      score: best ? Number((best.Similarity / 100).toFixed(3)) : 0,
      sourceFaces: res.SourceImageFace ? 1 : 0,
      // Every face found in the target: probing a photo against itself
      // (detectPerson), how many people are in it.
      targetFaces: (res.FaceMatches?.length || 0) + (res.UnmatchedFaces?.length || 0),
      warnings: [],
    };
  } catch (err) {
    // A face-not-detected error is an answer about this pair, not a fault.
    if (err?.name === 'InvalidParameterException') return { status: 'no_face', warnings: ['no_face_detected'] };
    console.warn('[MatchEngine] AWS Rekognition comparison failed:', err.message);
    return { status: 'no_answer', detail: err.message };
  }
}

function providersFor(cfg = config()) {
  return {
    aarakshak: { ready: Boolean(cfg.aarakshakKey), compare: (s, t) => compareFacesAarakshak(cfg, s, t) },
    rekognition: { ready: cfg.rekognitionReady, compare: (s, t) => compareFacesAWS(s, t) },
  };
}

/**
 * Decides whether an uploaded photo actually shows a person, and how many.
 * See worker/src/match.js for the reasoning and shared/match-pipeline.js
 * (screenPhoto) for the verdicts; this is the Node build of the same screen.
 */
export async function detectPerson(photoBuf) {
  return screenPhoto(photoBuf, providersFor());
}

/**
 * Asks each provider a question it must be able to answer, and reports what
 * came back. See worker/src/match.js for why this exists; this is the Node
 * build of the same probe. Never returns credentials.
 */
export async function probeMatchProviders(photoBuf) {
  const results = [];
  const cfg = config();

  if (!cfg.aarakshakKey) {
    results.push({ provider: ENGINES.aarakshak.provider, ok: false, detail: 'AARAKSHAK_API_KEY is not set for this deployment.' });
  } else {
    const started = Date.now();
    const res = await compareFacesAarakshak(cfg, photoBuf, photoBuf);
    const elapsedMs = Date.now() - started;
    results.push(
      res.status === 'answered' || res.status === 'no_face'
        ? { provider: ENGINES.aarakshak.provider, ok: true, elapsedMs, detail: res.status === 'answered' ? `answered, self-similarity ${res.score}, faces ${res.sourceFaces}` : 'answered: no face found in the probe photo' }
        : { provider: ENGINES.aarakshak.provider, ok: false, elapsedMs, detail: 'No answer — see the server log for the status it returned.' }
    );
  }

  if (!cfg.rekognitionReady) {
    results.push({ provider: ENGINES.rekognition.provider, ok: false, detail: 'AWS credentials are not set for this deployment.' });
  } else {
    const started = Date.now();
    const res = await compareFacesAWS(photoBuf, photoBuf);
    const elapsedMs = Date.now() - started;
    results.push(
      res.status === 'answered' || res.status === 'no_face'
        ? { provider: ENGINES.rekognition.provider, ok: true, elapsedMs, detail: res.status === 'answered' ? `answered, self-similarity ${res.score}` : 'answered: no face found in the probe photo' }
        : { provider: ENGINES.rekognition.provider, ok: false, elapsedMs, detail: res.status === 'no_answer' ? 'No answer — check credentials, region and the Rekognition policy.' : `Not asked: ${res.status}` }
    );
  }

  return results;
}

// ---- Orchestration ---------------------------------------------------------

/**
 * Compares one photo with a set of stored records (shared/match-pipeline.js).
 * Photo reads hit the database, so they run concurrently rather than one round
 * trip per candidate.
 */
async function rankStored(photoBuf, stored, readPhoto, { direction = 'forward', pool, noun = 'open case' } = {}) {
  const cfg = config();
  const started = Date.now();
  let outcome = null;
  if (stored.length) {
    const loaded = await mapLimit(stored, cfg.concurrency, async (report) => ({
      report,
      targetBuf: await readPhoto(report.photoFile),
    }));
    const comparable = loaded.filter((row) => row.targetBuf);
    if (comparable.length) {
      outcome = await comparePhotos({
        photoBuf,
        comparable,
        direction,
        providers: providersFor(cfg),
        confirmThreshold: cfg.confirmThreshold,
        secondOpinionTopN: cfg.secondOpinionTopN,
        concurrency: cfg.concurrency,
      });
    }
  }
  return rankResult({
    outcome,
    pool,
    settings: settingsOf(cfg),
    started,
    rekognitionReady: cfg.rekognitionReady,
    confirmThreshold: cfg.confirmThreshold,
    aarakshakThreshold: cfg.aarakshakThreshold,
    noun,
    storedCount: stored.length,
  });
}

/**
 * Ranks still-missing people against an uploaded sighting photo.
 *
 * `source` overrides where the cases and photos come from (the engine tests
 * pass their own); by default, this server's store.
 *
 * @param {Buffer} photoBuf
 * @param {{state?:string, district?:string, gender?:string, ageApprox?:number, excludeReportIds?:string[], shortlist?:string[], indexProvider?:string}} hints
 * @returns {Promise<{candidates:{report:any, score:number}[], engine:object}>}
 */
export async function rankMatches(photoBuf, hints = {}, source = {}) {
  const cfg = config();
  if (!photoBuf?.length) {
    return { candidates: [], engine: { ...ENGINES.none, settings: settingsOf(cfg) } };
  }
  const reports = source.reports || listReports();
  const readPhoto = source.readPhoto || readStoredPhoto;
  const { reports: withPhotos, pool } = selectMatchCandidates(reports, hints, cfg.forwardBudget);
  return rankStored(photoBuf, withPhotos, readPhoto, { direction: 'forward', pool, noun: 'open case' });
}

/**
 * Ranks stored sightings (and open found-child intakes, standing in for their
 * sightings) against a newly registered case's photo: the reverse of
 * rankMatches. See worker/src/match.js for the Worker build of the same search.
 *
 * @param {Buffer} casePhotoBuf
 * @param {{state?:string, district?:string, reportId?:string, subject?:object}} hints  the case
 * @returns {Promise<{candidates:{sighting:any, score:number}[], engine:object}>}
 */
export async function rankSightingMatches(casePhotoBuf, hints = {}, source = {}) {
  const cfg = config();
  if (!casePhotoBuf?.length) {
    return { candidates: [], engine: { ...ENGINES.none, settings: settingsOf(cfg) } };
  }
  const foundReports = source.foundReports || listFoundReports();
  const intakeReports = source.reports || listReports();
  const readPhoto = source.readPhoto || readStoredPhoto;
  const { sightings, pool } = selectSightingCandidates(foundReports, hints, cfg.reverseBudget, Date.now(), { intakeReports });
  const ranked = await rankStored(casePhotoBuf, sightings, readPhoto, { direction: 'reverse', pool, noun: 'stored sighting' });
  return {
    candidates: ranked.candidates.map(({ report, ...rest }) => ({ ...rest, sighting: report })),
    engine: ranked.engine,
  };
}
