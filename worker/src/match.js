import crypto from 'node:crypto';

import { compareFacesRekognition, rekognitionConfigured } from './rekognition.js';
import { selectMatchCandidates, selectSightingCandidates } from '../../shared/match-pool.js';
import { engineSettings } from '../../shared/match-config.js';
import { ENGINES, comparePhotos, mapLimit, rankResult, screenPhoto } from '../../shared/match-pipeline.js';
import { detectImageMime, imageExtension } from '../../shared/photo-format.js';

// The rules - who proposes, who confirms, what happens when an engine does not
// answer - live in shared/match-pipeline.js, which the Node build
// (server/src/match.js) runs too. This file supplies only the Worker's way of
// reaching the two providers.

export { ENGINES };

const DEFAULT_AARAKSHAK_API_URL = 'https://aarakshak.com/api/v1/compare';

/**
 * Per-comparison ceiling on the provider call.
 *
 * Comfortably above a normal answer and well inside the phone's own 45-second
 * abort, so a slow provider degrades to "no biometric answer for this
 * candidate" — which the pipeline already reports honestly — rather than to a
 * citizen staring at a spinner until their client gives up.
 */
const AARAKSHAK_TIMEOUT_MS = 12000;

/**
 * Secrets arrive exactly as they were typed. On 3 September the Aarakshak key
 * was pasted from a file saved with a UTF-8 byte-order mark, so every request
 * carried "X-API-Key: ﻿fr_live_..." and the provider answered HTTP 500 to
 * all of them -- for hours, silently, while the dashboard read "no match".
 * trim() strips U+FEFF along with ordinary whitespace, which covers the two
 * ways a copied credential goes wrong. The AWS reads in rekognition.js
 * already do this.
 */
const cleanSecret = (value) => String(value || '').trim();

const read = (env, name) => env?.[name] || process.env[name];

/**
 * How many photo reads or provider calls run at once: at most 5.
 *
 * A Worker invocation holds at most six outbound connections open at a time
 * and queues the rest, and a queued fetch's abort timer is already running. The
 * reverse search compares a new case with up to 50 sightings; fired all at
 * once, the calls past the first few waves sat in that queue until their 12
 * seconds ran out, and the oldest, furthest sightings - last in the list - were
 * silently never compared. Express runs the same pipeline five at a time
 * (server/src/match.js), so both runtimes compare every candidate.
 */
function matchConcurrency(env) {
  const n = Number(read(env, 'KHOZO_MATCH_CONCURRENCY') || 5);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? Math.floor(n) : 5));
}

/** Everything the engine is configured with, read per call from the Worker's env. */
function config(env) {
  const secondOpinion = read(env, 'KHOZO_SECOND_OPINION_TOP_N');
  return {
    aarakshakUrl: cleanSecret(read(env, 'AARAKSHAK_API_URL')) || DEFAULT_AARAKSHAK_API_URL,
    aarakshakKey: cleanSecret(read(env, 'AARAKSHAK_API_KEY')),
    aarakshakThreshold: String(read(env, 'AARAKSHAK_THRESHOLD') || '0.35'),
    aarakshakTimeoutMs: Number(read(env, 'AARAKSHAK_TIMEOUT_MS')) || AARAKSHAK_TIMEOUT_MS,
    rekognitionReady: rekognitionConfigured(env),
    confirmThreshold: confirmThreshold(env),
    secondOpinionTopN: secondOpinion === undefined || secondOpinion === '' ? 5 : Math.max(0, Number(secondOpinion) || 0),
    concurrency: matchConcurrency(env),
  };
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

export function matchEngineInfo(env) {
  const cfg = config(env);
  const aarakshakReady = Boolean(cfg.aarakshakKey);
  const rekognitionReady = cfg.rekognitionReady;
  const active = aarakshakReady ? ENGINES.aarakshak : rekognitionReady ? ENGINES.rekognition : ENGINES.heuristic;
  return {
    ...active,
    aarakshakConfigured: aarakshakReady,
    rekognitionConfigured: rekognitionReady,
    fallbackProvider: aarakshakReady && rekognitionReady ? ENGINES.rekognition.provider : ENGINES.heuristic.provider,
    forwardBudget: Number(read(env, 'KHOZO_MATCH_CANDIDATES') || 25),
    reverseBudget: Number(read(env, 'KHOZO_REVERSE_MATCH_CANDIDATES') || 50),
    settings: settingsOf(cfg),
    note: aarakshakReady || rekognitionReady
      ? active.note
      : 'No biometric provider is configured. Set AARAKSHAK_API_KEY or AWS credentials to enable face comparison.',
  };
}

/**
 * Builds a multipart/form-data body as one buffer, with an explicit boundary.
 *
 * The Workers runtime streams a `FormData` body with chunked transfer-encoding
 * and no `Content-Length`. Aarakshak's parser answered that with HTTP 500 — the
 * identical request from Node, which sends a measured body, returned a score.
 * Building the bytes here gives the request a length and makes the two runtimes
 * send the same thing.
 */
function multipartBody(parts) {
  const boundary = `----khozo${crypto.randomBytes(16).toString('hex')}`;
  const chunks = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const headers =
      `--${boundary}\r\nContent-Disposition: ${disposition}\r\n` +
      (part.contentType ? `Content-Type: ${part.contentType}\r\n` : '') +
      '\r\n';
    chunks.push(Buffer.from(headers, 'utf8'));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value), 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function imagePart(name, buf) {
  const bytes = Buffer.from(buf);
  return { name, filename: `${name.replace('_image', '')}.${imageExtension(bytes)}`, contentType: detectImageMime(bytes) || 'image/jpeg', value: bytes };
}

/** Whether an error is our own timeout, which a retry would only repeat. */
const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

/**
 * Compares two images with the Aarakshak API, as a normalised answer
 * (shared/match-pipeline.js). One retry on a network fault or a 5xx, as the
 * Node build does: a provider that drops one connection in fifty should not
 * silently lose a candidate.
 */
async function compareFacesAarakshak(cfg, sourceBuf, targetBuf, attempt = 0) {
  if (!cfg.aarakshakKey) return { status: 'not_configured' };
  if (!sourceBuf?.length || !targetBuf?.length) return { status: 'no_answer', detail: 'empty image' };

  try {
    const { body, contentType } = multipartBody([
      imagePart('source_image', sourceBuf),
      imagePart('target_image', targetBuf),
      { name: 'threshold', value: String(cfg.aarakshakThreshold) },
    ]);

    const res = await fetch(cfg.aarakshakUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': cfg.aarakshakKey,
        'Content-Type': contentType,
      },
      // A typed array is a fixed-length body, so the runtime sets Content-Length
      // itself. Setting it by hand alongside a Node Buffer is the combination
      // that produced a body the provider answered with HTTP 500.
      body: new Uint8Array(body),
      // Bounds one call. Calls are issued at most five at a time (mapLimit),
      // so the clock starts when this call actually goes out, not while it
      // waits behind others for a connection.
      signal: AbortSignal.timeout(cfg.aarakshakTimeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Aarakshak tags every response with X-Request-ID; their support needs it
      // to trace a failure, so it goes into every log line and result.
      const requestId = res.headers.get('x-request-id') || null;
      const ref = requestId ? ` (X-Request-ID ${requestId})` : '';
      if (res.status >= 500 && attempt === 0) {
        console.warn(`[WorkerMatchEngine] Aarakshak HTTP ${res.status}${ref}, retrying once: ${detail.slice(0, 200)}`);
        return compareFacesAarakshak(cfg, sourceBuf, targetBuf, attempt + 1);
      }
      // "No detectable face" is an answer about this pair - the engine could
      // not find a face to compare - and the pipeline treats it as unknown,
      // not as a score of 0 (no single-engine veto).
      if (/no detectable face|no_face|comparison_failed/i.test(detail)) {
        return { status: 'no_face', sourceFaces: 0, targetFaces: 0, warnings: ['no_face_detected'] };
      }
      // Logged, always. A provider that fails silently is indistinguishable
      // from one that is working and finding nothing.
      console.warn(`[WorkerMatchEngine] Aarakshak HTTP ${res.status}${ref}: ${detail.slice(0, 200)}`);
      return { status: 'no_answer', detail: `HTTP ${res.status}${ref}`, requestId };
    }
    const data = await res.json();
    const raw = data.score ?? data.similarity ?? data.match_confidence;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return { status: 'no_answer', detail: 'no usable score' };
    // An explicit empty face list is the provider saying it found no face,
    // whatever number it put beside that.
    if ((Array.isArray(data.source_faces) && !data.source_faces.length) || (Array.isArray(data.target_faces) && !data.target_faces.length)) {
      return { status: 'no_face', sourceFaces: data.source_faces?.length ?? 0, targetFaces: data.target_faces?.length ?? 0, warnings: ['no_face_detected'] };
    }

    // Scores for clearly different faces come back slightly negative, so clamp.
    const score = Number(Math.max(0, Math.min(1, raw)).toFixed(3));
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
    if (!isTimeout(err) && attempt === 0) return compareFacesAarakshak(cfg, sourceBuf, targetBuf, attempt + 1);
    console.warn(`[WorkerMatchEngine] Aarakshak comparison failed${isTimeout(err) ? ' (timeout)' : ''}:`, err.message);
    return { status: 'no_answer', detail: err.message };
  }
}

/** Rekognition, as a normalised answer. */
async function compareFacesRekognitionAnswer(env, sourceBuf, targetBuf) {
  const diagnostics = {};
  const res = await compareFacesRekognition(env, sourceBuf, targetBuf, diagnostics);
  if (!res) {
    const reason = diagnostics.reason;
    return { status: ['not_configured', 'unsupported_format', 'too_large'].includes(reason) ? reason : 'no_answer', detail: diagnostics.detail || null };
  }
  if (res.noFace) return { status: 'no_face', warnings: res.warnings || ['no_face_detected'] };
  return { status: 'answered', ...res };
}

function providersFor(env, cfg = config(env)) {
  return {
    aarakshak: { ready: Boolean(cfg.aarakshakKey), compare: (s, t) => compareFacesAarakshak(cfg, s, t) },
    rekognition: { ready: cfg.rekognitionReady, compare: (s, t) => compareFacesRekognitionAnswer(env, s, t) },
  };
}

/**
 * Decides whether an uploaded photo actually shows a person.
 *
 * The upload endpoint is public and unauthenticated, so anything can arrive:
 * screenshots, scenery, posters, an accidental photo of the floor. Alerting
 * every authority in the country on each of those trains officers to ignore the
 * alert that matters, so only a photo with a face in it raises the general
 * alarm. Everything else still reaches a human — the super admin — rather than
 * being discarded, because the cost of wrongly dropping a real sighting is a
 * child nobody looks for. The same screen checks a case photo when it is
 * registered (`photoCheck`), where it also counts the faces.
 *
 * See screenPhoto in shared/match-pipeline.js for the verdicts.
 */
export async function detectPerson(env, photoBuf) {
  return screenPhoto(photoBuf, providersFor(env));
}

/**
 * Asks each provider a question it must be able to answer, and reports what
 * came back. Run from inside the deployment, because a provider reachable from
 * a laptop can be unreachable from the Worker and the only symptom was matching
 * quietly falling back to no result.
 *
 * Never returns credentials — status and message only.
 */
export async function probeMatchProviders(env, photoBuf) {
  const results = [];
  const cfg = config(env);

  if (!cfg.aarakshakKey) {
    results.push({ provider: ENGINES.aarakshak.provider, ok: false, detail: 'AARAKSHAK_API_KEY is not set for this deployment.' });
  } else {
    const started = Date.now();
    try {
      const { body, contentType } = multipartBody([
        imagePart('source_image', photoBuf),
        imagePart('target_image', photoBuf),
        { name: 'threshold', value: String(cfg.aarakshakThreshold) },
      ]);
      const res = await fetch(cfg.aarakshakUrl, {
        method: 'POST',
        headers: {
          'X-API-Key': cfg.aarakshakKey,
          'Content-Type': contentType,
        },
        body: new Uint8Array(body),
      });
      const text = await res.text().catch(() => '');
      const elapsedMs = Date.now() - started;
      if (!res.ok) {
        results.push({ provider: ENGINES.aarakshak.provider, ok: false, status: res.status, elapsedMs, requestId: res.headers.get('x-request-id') || null, detail: text.slice(0, 300) });
      } else {
        let score = null;
        try {
          const data = JSON.parse(text);
          score = data.score ?? data.similarity ?? data.match_confidence ?? null;
        } catch {
          // fall through to the unusable-body branch below
        }
        results.push(
          typeof score === 'number'
            ? { provider: ENGINES.aarakshak.provider, ok: true, elapsedMs, detail: `answered, self-similarity ${score}` }
            : { provider: ENGINES.aarakshak.provider, ok: false, elapsedMs, detail: `HTTP 200 with no usable score: ${text.slice(0, 200)}` }
        );
      }
    } catch (err) {
      results.push({ provider: ENGINES.aarakshak.provider, ok: false, elapsedMs: Date.now() - started, detail: `${err.name}: ${err.message}` });
    }
  }

  if (!rekognitionConfigured(env)) {
    results.push({ provider: ENGINES.rekognition.provider, ok: false, detail: 'AWS credentials are not set for this deployment.' });
  } else {
    const started = Date.now();
    const diagnostics = {};
    const res = await compareFacesRekognition(env, photoBuf, photoBuf, diagnostics);
    const elapsedMs = Date.now() - started;
    results.push(
      res
        ? { provider: ENGINES.rekognition.provider, ok: true, elapsedMs, detail: `answered, self-similarity ${res.score}` }
        : {
            provider: ENGINES.rekognition.provider,
            ok: false,
            elapsedMs,
            detail: diagnostics.detail || 'No answer — check credentials, region and the Rekognition policy.',
          }
    );
  }

  return results;
}

/**
 * Rekognition similarity at or above which the second opinion counts as
 * agreement, and a candidate may be put in front of an officer. AWS's own
 * guidance for general face comparison, below their 0.99 identity-verification
 * bar — right here because a human confirms afterwards, but high enough that
 * the two engines have to actually agree about a face.
 */
function confirmThreshold(env) {
  return Number(read(env, 'KHOZO_REKOGNITION_CONFIRM') || 0.8);
}

/**
 * Compares one photo with a set of stored records (shared/match-pipeline.js).
 * `direction` only decides which photo is the source, and `noun` only words
 * the engine's notes. Each candidate carries the stored record under `report`,
 * whichever kind of record it is.
 */
async function rankStored(env, photoBuf, stored, readPhoto, { direction = 'forward', pool, noun = 'open case' } = {}) {
  const cfg = config(env);
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
        providers: providersFor(env, cfg),
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
 * Ranks open cases against a sighting photo.
 *
 * `source` supplies the candidate cases and a photo reader. Both come from the
 * request's store replica, which has already read the case rows, so ranking
 * costs no additional query for them. `hints` may carry a one-to-many index
 * shortlist (shared/match-pool.js selectMatchCandidates).
 */
export async function rankMatches(env, photoBuf, hints = {}, source = {}) {
  const cfg = config(env);
  if (!photoBuf?.length) {
    return { candidates: [], engine: { ...ENGINES.none, settings: settingsOf(cfg) } };
  }

  const reports = source.reports || [];
  const readPhoto = source.readPhoto || (async () => null);
  const maxCandidates = Number(read(env, 'KHOZO_MATCH_CANDIDATES') || 25);
  const { reports: withPhotos, pool } = selectMatchCandidates(reports, hints, maxCandidates);
  return rankStored(env, photoBuf, withPhotos, readPhoto, { direction: 'forward', pool, noun: 'open case' });
}

/**
 * Ranks stored sightings (and open found-child intakes, standing in for their
 * sightings) against a newly registered case's photo: the reverse of
 * rankMatches, for the person photographed before anyone reported them
 * missing.
 *
 * Same engines, same order of the two photos in each comparison, same
 * confirmation rule and thresholds as the forward search; only the pool
 * differs (shared/match-pool.js selectSightingCandidates, budget
 * KHOZO_REVERSE_MATCH_CANDIDATES). Each candidate carries the compared record
 * under `sighting`.
 */
export async function rankSightingMatches(env, casePhotoBuf, hints = {}, source = {}) {
  const cfg = config(env);
  if (!casePhotoBuf?.length) {
    return { candidates: [], engine: { ...ENGINES.none, settings: settingsOf(cfg) } };
  }

  const foundReports = source.foundReports || [];
  const intakeReports = source.reports || [];
  const readPhoto = source.readPhoto || (async () => null);
  const maxCandidates = Number(read(env, 'KHOZO_REVERSE_MATCH_CANDIDATES') || 50);
  const { sightings, pool } = selectSightingCandidates(foundReports, hints, maxCandidates, Date.now(), { intakeReports });
  const ranked = await rankStored(env, casePhotoBuf, sightings, readPhoto, {
    direction: 'reverse',
    pool,
    noun: 'stored sighting',
  });
  return {
    candidates: ranked.candidates.map(({ report, ...rest }) => ({ ...rest, sighting: report })),
    engine: ranked.engine,
  };
}
