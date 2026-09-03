import crypto from 'node:crypto';

import { compareFacesRekognition, rekognitionConfigured } from './rekognition.js';

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

/**
 * Ranks candidates without comparing faces. Returns nothing, deliberately.
 *
 * This used to score every open case at `0.45 + hash(photo bytes) * 0.5` — a
 * number between 45% and 95% derived from the image's bytes, not from anyone's
 * face. Those scores cleared the review threshold, were stored as `matchScore`,
 * and were shown to officers as "AI Match Similarity Confidence" under a
 * biometric provider's name. A photograph of an adult man was presented as an
 * 83% match to a missing girl, above a button reading "Confirm Match & Reunite".
 *
 * There is no honest way to rank faces without comparing faces. With no
 * biometric answer the right output is no candidate and a stated reason.
 */
function rankWithHeuristic() {
  return [];
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
 * Decides whether an uploaded photo actually shows a person.
 *
 * The upload endpoint is public and unauthenticated, so anything can arrive:
 * screenshots, scenery, posters, an accidental photo of the floor. Alerting
 * every authority in the country on each of those trains officers to ignore the
 * alert that matters, so only a photo with a face in it raises the general
 * alarm. Everything else still reaches a human — the super admin — rather than
 * being discarded, because the cost of wrongly dropping a real sighting is a
 * child nobody looks for.
 *
 * Detection reuses the comparison endpoint by probing the image against itself:
 * the provider reports the faces it found in the source image, which is the
 * signal needed, without depending on a second service.
 *
 * Three verdicts, and the caller must treat the last two the same way:
 *   person      — a face was found; raise the alert
 *   no_person   — the provider looked and found none
 *   unverified  — no provider answered, so nothing is known
 */
export async function detectPerson(env, photoBuf) {
  if (!photoBuf?.length) {
    return { verdict: 'no_photo', faces: 0, provider: null, checkedAt: Date.now() };
  }

  const probe = await compareFacesAarakshak(env, photoBuf, photoBuf);
  if (probe) {
    return {
      verdict: probe.sourceFaces > 0 ? 'person' : 'no_person',
      faces: probe.sourceFaces,
      quality: probe.sourceQuality ?? null,
      warnings: probe.warnings || [],
      provider: ENGINES.aarakshak.provider,
      checkedAt: Date.now(),
    };
  }

  return {
    verdict: 'unverified',
    faces: null,
    provider: null,
    reason: 'No face-detection provider answered; the photo has not been screened.',
    checkedAt: Date.now(),
  };
}

/**
 * Rekognition similarity at or above which the second opinion counts as
 * agreement, and a candidate may be put in front of an officer. AWS's own
 * guidance for general face comparison, below their 0.99 identity-verification
 * bar — right here because a human confirms afterwards, but high enough that
 * the two engines have to actually agree about a face.
 */
function confirmThreshold(env) {
  return Number(env?.KHOZO_REKOGNITION_CONFIRM || process.env.KHOZO_REKOGNITION_CONFIRM || 0.8);
}

/**
 * Asks Rekognition about the top candidates Aarakshak proposed.
 *
 * Confirmation, not inflation: the surviving score is the *lower* of the two.
 * Taking the higher let one engine overrule the other, so two engines
 * disagreeing produced a more confident number than either alone.
 */
async function addSecondOpinion(env, photoBuf, ranked, readPhoto) {
  if (!rekognitionConfigured(env) || !ranked.length) {
    return { candidates: ranked.map((c) => ({ ...c, confirmed: false, secondOpinion: 'unavailable' })), applied: false, checked: 0 };
  }

  let checked = 0;
  const threshold = confirmThreshold(env);

  const reviewed = await Promise.all(
    ranked.map(async (candidate) => {
      const targetBuf = await readPhoto(candidate.report.photoFile);
      if (!targetBuf) return { ...candidate, confirmed: false, secondOpinion: 'photo_unavailable' };
      const second = await compareFacesRekognition(env, photoBuf, targetBuf);
      if (!second) return { ...candidate, confirmed: false, secondOpinion: 'no_answer' };
      checked += 1;
      return {
        ...candidate,
        primaryScore: candidate.score,
        secondOpinionScore: second.score,
        secondOpinionProvider: ENGINES.rekognition.provider,
        score: Math.min(candidate.score, second.score),
        confirmed: second.score >= threshold,
        secondOpinion: second.score >= threshold ? 'agrees' : 'disagrees',
        enginesDisagree: Math.abs(candidate.score - second.score) >= 0.25,
      };
    })
  );

  return { candidates: reviewed.sort((a, b) => b.score - a.score), applied: checked > 0, checked };
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
        const ranked = answered.sort((a, b) => b.score - a.score).slice(0, 5);

        // Second opinion. One engine proposing a face is a lead; two engines
        // agreeing is a candidate. Anything Rekognition does not confirm is
        // withheld rather than shown with a slightly lower number, because the
        // number is what an officer acts on.
        const second = await addSecondOpinion(env, photoBuf, ranked, readPhoto);
        const candidates = second.applied ? second.candidates.filter((c) => c.confirmed) : second.candidates;

        return {
          candidates,
          engine: {
            ...ENGINES.aarakshak,
            comparedAgainst: withPhotos.length,
            threshold: Number(env?.AARAKSHAK_THRESHOLD || 0.35),
            elapsedMs: Date.now() - started,
            corroborated: second.applied,
            secondOpinion: second.applied
              ? {
                  provider: ENGINES.rekognition.provider,
                  checked: second.checked,
                  confirmed: second.candidates.filter((c) => c.confirmed).length,
                  withheld: second.candidates.filter((c) => !c.confirmed).length,
                  threshold: confirmThreshold(env),
                }
              : null,
            sightingQuality: ranked[0]?.sourceQuality ?? null,
            qualityWarnings: [...new Set(ranked.flatMap((c) => c.warnings || []))],
          },
        };
      }

      // Aarakshak did not answer. Rekognition alone, held to the same bar it is
      // used to apply as the confirming engine.
      if (rekognitionConfigured(env)) {
        const viaRekognition = (
          await Promise.all(
            comparable.map(async ({ report, targetBuf }) => {
              const res = await compareFacesRekognition(env, photoBuf, targetBuf);
              return res === null ? null : { report, ...res };
            })
          )
        )
          .filter(Boolean)
          .filter((c) => c.score >= confirmThreshold(env))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((c) => ({ ...c, confirmed: true, secondOpinion: 'sole_engine' }));

        if (viaRekognition.length) {
          return {
            candidates: viaRekognition,
            engine: {
              ...ENGINES.rekognition,
              comparedAgainst: withPhotos.length,
              elapsedMs: Date.now() - started,
              threshold: confirmThreshold(env),
              corroborated: false,
            },
          };
        }
      }
    }
  }

  // Nothing biometric answered. No candidate is returned: there is no honest
  // way to rank faces without comparing faces, and a number invented here is
  // one an officer would act on.
  return {
    candidates: rankWithHeuristic(),
    engine: {
      ...ENGINES.heuristic,
      comparedAgainst: 0,
      reason: withPhotos.length
        ? 'No biometric provider answered, so no face comparison was made and no candidate is offered.'
        : 'No stored case photos to compare against, so no face comparison was possible.',
    },
  };
}
