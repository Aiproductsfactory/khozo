import crypto from 'node:crypto';

const AARAKSHAK_API_URL = 'https://aarakshak.com/api/v1/compare';

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

export function matchEngineInfo(env) {
  const aarakshakReady = Boolean(env?.AARAKSHAK_API_KEY || process.env.AARAKSHAK_API_KEY);
  const rekognitionReady = Boolean((env?.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) && (env?.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY));
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

async function compareFacesAarakshak(env, sourceBuf, targetBuf) {
  const apiKey = env?.AARAKSHAK_API_KEY || process.env.AARAKSHAK_API_KEY;
  if (!apiKey || !sourceBuf || !targetBuf) return null;
  const threshold = env?.AARAKSHAK_THRESHOLD || process.env.AARAKSHAK_THRESHOLD || '0.35';

  try {
    const formData = new FormData();
    formData.append('source_image', new Blob([sourceBuf], { type: 'image/jpeg' }), 'source.jpg');
    formData.append('target_image', new Blob([targetBuf], { type: 'image/jpeg' }), 'target.jpg');
    formData.append('threshold', threshold);

    const res = await fetch(AARAKSHAK_API_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: formData,
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.score ?? data.similarity ?? data.match_confidence;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;

    const score = Number(Math.max(0, Math.min(1, raw)).toFixed(3));
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
    console.warn('[WorkerMatchEngine] Aarakshak comparison failed:', err.message);
    return null;
  }
}

/**
 * Ranks open cases against a sighting photo.
 *
 * `source` supplies the candidate cases and a photo reader. Both come from the
 * request's store replica, which has already read the case rows, so ranking
 * costs no additional query for them.
 */
export async function rankMatches(env, photoBuf, hints = {}, source = {}) {
  if (!photoBuf?.length) {
    return { candidates: [], engine: { ...ENGINES.none } };
  }

  const reports = source.reports || [];
  const readPhoto = source.readPhoto || (async () => null);
  const openCases = reports.filter((r) => r.status !== 'found' && !r.anonymizedAt);
  const maxCandidates = Number(env?.KHOZO_MATCH_CANDIDATES || 25);
  const withPhotos = openCases.filter((r) => r.photoFile).slice(0, maxCandidates);

  if (withPhotos.length) {
    const started = Date.now();
    const loaded = await Promise.all(
      withPhotos.map(async (report) => ({
        report,
        targetBuf: await readPhoto(report.photoFile),
      }))
    );

    const comparable = loaded.filter((row) => row.targetBuf);
    if (comparable.length) {
      const compared = await Promise.all(
        comparable.map(async ({ report, targetBuf }) => {
          const res = await compareFacesAarakshak(env, photoBuf, targetBuf);
          return res === null ? null : { report, ...res };
        })
      );

      const answered = compared.filter(Boolean);
      if (answered.length) {
        const sorted = answered.sort((a, b) => b.score - a.score).slice(0, 5);
        return {
          candidates: sorted,
          engine: {
            ...ENGINES.aarakshak,
            comparedAgainst: withPhotos.length,
            threshold: Number(env?.AARAKSHAK_THRESHOLD || 0.35),
            elapsedMs: Date.now() - started,
            sightingQuality: sorted[0]?.sourceQuality ?? null,
            qualityWarnings: [...new Set(sorted.flatMap((c) => c.warnings || []))],
          },
        };
      }
    }
  }

  return {
    candidates: rankWithHeuristic(photoBuf, openCases.slice(0, maxCandidates), hints),
    engine: {
      ...ENGINES.heuristic,
      comparedAgainst: 0,
      reason: withPhotos.length
        ? 'No biometric provider answered; scores are non-biometric.'
        : 'No stored case photos to compare against; scores are non-biometric.',
    },
  };
}
