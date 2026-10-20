/**
 * The settings a face-match result was produced under, and a short hash of
 * them.
 *
 * Every match result is stored with the thresholds it was judged against and
 * a `configHash` of the engine settings. A sighting searched while Rekognition
 * was unconfigured, or before a threshold was recalibrated, was searched under
 * different rules from one searched today; the hash is how the re-match batch
 * (POST /api/dashboard/rematch-sightings) finds those sightings, and how an
 * auditor reading a result months later knows which rules produced it.
 *
 * Both engines (worker/src/match.js, server/src/match.js) build their settings
 * through engineSettings() so that the same configuration hashes the same on
 * either runtime.
 */
import crypto from 'node:crypto';

import { MATCH_REVIEW_THRESHOLD } from './case-domain.js';

/**
 * Bumped whenever the pipeline's rules change in a way that could change a
 * result for the same photos and the same thresholds. This version: per-
 * candidate engine records, no single-engine veto, the "not checked" lane.
 */
export const MATCH_PIPELINE_VERSION = 'candidates-2026-10';

/** How many candidates a search keeps (and an officer can walk through). */
export const MAX_MATCH_CANDIDATES = 5;

const round = (value) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(4)) : null);

/** The settings object both engines report, normalised so it hashes stably. */
export function engineSettings({
  aarakshakConfigured = false,
  aarakshakModel = null,
  aarakshakThreshold = null,
  rekognitionConfigured = false,
  rekognitionModel = null,
  rekognitionConfirm = null,
  secondOpinionTopN = MAX_MATCH_CANDIDATES,
} = {}) {
  return {
    pipeline: MATCH_PIPELINE_VERSION,
    aarakshak: aarakshakConfigured ? { model: aarakshakModel || null, threshold: round(aarakshakThreshold) } : null,
    rekognition: rekognitionConfigured
      ? { model: rekognitionModel || null, confirm: round(rekognitionConfirm), secondOpinionTopN: Number(secondOpinionTopN) || 0 }
      : null,
    reviewThreshold: round(MATCH_REVIEW_THRESHOLD),
    // No longer used: the engines now disagree when they land on different
    // sides of their own match lines (shared/match-verdict.js), which needs no
    // setting. Kept so every stored result keeps its configuration hash, and
    // the re-match batch does not search every sighting again for a change to
    // a flag that decides nothing about which cases are proposed.
    disagreementGap: 0.25,
  };
}

/** The thresholds a result was judged against, for the record. */
export function thresholdsOf(settings = {}) {
  return {
    review: settings.reviewThreshold ?? round(MATCH_REVIEW_THRESHOLD),
    aarakshak: settings.aarakshak?.threshold ?? null,
    rekognitionConfirm: settings.rekognition?.confirm ?? null,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * 16 hex characters identifying the engine settings plus the one-to-many
 * index provider in use (shared/face-index.js), which changes which cases a
 * sighting is compared with.
 */
export function configHashOf(settings = {}, indexProvider = 'none') {
  const canonical = stableJson({ ...settings, index: indexProvider || 'none' });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
