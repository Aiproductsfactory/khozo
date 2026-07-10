// Face-match provider boundary.
//
// The demo uses a deterministic local scorer so the intake and review workflow can run without
// Python/ML dependencies. When the Aarakshak recognition API is ready, keep the public route and
// dashboard code unchanged: replace `rankWithDemoScorer` or add an HTTP provider here that returns
// the same `{ candidates, engine }` contract from `rankMatches`.

import { listReports } from './store.js';

const DEMO_ENGINE = {
  provider: 'demo-local',
  modelVersion: 'heuristic-2026-06',
  biometric: false,
  note: 'Deterministic workflow scorer; not a face-recognition model.',
};

export function matchEngineInfo() {
  return { ...DEMO_ENGINE };
}

// Cheap, stable hash of a buffer -> [0,1).
function hashUnit(buf) {
  let h = 2166136261;
  for (let i = 0; i < buf.length; i += 997) {
    h ^= buf[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function scoreCandidate(seedUnit, report, hints) {
  // Base similarity is driven by the image hash so the same photo gives stable results.
  let score = 0.45 + seedUnit * 0.5;
  // Nudge by soft attribute hints the reporter may have provided.
  if (hints?.gender && report.gender && hints.gender === report.gender) score += 0.04;
  if (hints?.ageApprox != null && report.age != null) {
    const diff = Math.abs(Number(hints.ageApprox) - report.age);
    score += Math.max(0, 0.06 - diff * 0.02);
  }
  // Only still-missing children are meaningful match targets.
  if (report.status === 'found') score -= 0.5;
  // Vary per-candidate so the ranking isn't flat.
  const jitter = hashUnit(Buffer.from(report.id)) * 0.18;
  return Math.max(0, Math.min(0.99, score - 0.09 + jitter * (1 - seedUnit)));
}

function rankWithDemoScorer(photoBuf, hints = {}) {
  if (!photoBuf?.length) return [];
  const seed = photoBuf?.length ? hashUnit(photoBuf) : Math.random();
  return listReports()
    .filter((r) => r.status !== 'found')
    .map((r) => ({ report: r, score: Number(scoreCandidate(seed, r, hints).toFixed(2)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Rank still-missing children against an uploaded photo.
 * Future Aarakshak API adapters should return this same shape:
 * `{ candidates: [{ report, score }], engine: { provider, modelVersion, biometric } }`.
 *
 * @param {Buffer} photoBuf
 * @param {{gender?:string, ageApprox?:number}} hints
 * @returns {{candidates:{report:any, score:number}[], engine:{provider:string, modelVersion:string, biometric:boolean, note?:string}}}
 */
export function rankMatches(photoBuf, hints = {}) {
  return {
    candidates: rankWithDemoScorer(photoBuf, hints),
    engine: DEMO_ENGINE,
  };
}
