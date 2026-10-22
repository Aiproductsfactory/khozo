/**
 * Linking sightings and cases: the forward search, the reverse search, the
 * ranked candidate list an officer walks, and the one-to-many index.
 *
 * Used by the case and sighting routes (shared/routes/reports.js) and by the
 * re-match batch (shared/routes/matching-admin.js), on both runtimes. What a
 * comparison is spent on is shared/match-pool.js; how two photos are compared
 * is shared/match-pipeline.js; this module decides what a result does to the
 * records.
 *
 * A sighting keeps its top candidates, not just the best one:
 *
 *   matchCandidates: [{ reportId, rank, score, aarakshakScore,
 *                       rekognitionScore, corroborated, notChecked,
 *                       enginesAnswered, status: 'proposed' | 'rejected' |
 *                       'confirmed', ... }]
 *
 * `matchedReportId` is the best candidate still proposed. When an officer
 * rejects it (or refers the sighting on), it is marked rejected, recorded in
 * `rejectedLinks`, and the sighting moves to the next proposed candidate - or,
 * when none is left, back to its own place and queue. A rejected pair is never
 * proposed again, in either direction.
 *
 * Nothing here tells the public anything. The person who sent a sighting gets
 * the same receipt and status whatever the engines found (publicSightingStatus
 * in shared/case-domain.js), and only the police officers who can open a case
 * are ever told a sighting may match it.
 */
import { POLICE_ROLES, SEEN_OUTSIDE_HINT, canAccessReport, seenOutsideCaseDistrict } from './scope.js';
import { MATCH_REVIEW_THRESHOLD, isAdultCategory, isPendingCitizenIntake, personCategoryOf } from './case-domain.js';
import {
  expectedAgeAt,
  isForwardPoolCase,
  isFoundChildIntake,
  isRematchEligible,
  isReverseMatchCandidate,
  rejectedReportIds,
  wasLinkRejected,
} from './match-pool.js';
import { MAX_MATCH_CANDIDATES, configHashOf, thresholdsOf } from './match-config.js';
import { INDEX_TOP_K, enrollCaseInIndex, removeCaseFromIndex, safeFaceIndex } from './face-index.js';
import { MAIN_PHOTO, isBadFacePhoto, leadPhotoOf, loadPhotos } from './photo-set.js';
import { sightingScreenVerdict } from './face-screen.js';

/**
 * Whether a comparison result is put in front of an officer.
 *
 * Calibrated against real Aarakshak output: photographs of the same person
 * score 0.48-0.86, different people score below 0.07. This only decides
 * whether an officer is shown the candidate - a human still confirms - so it is
 * set to catch matches, not to be conservative. A candidate reaches an officer
 * only when a biometric engine compared the faces.
 */
export function isStrongMatch(candidate, engine) {
  return Boolean(candidate) && Boolean(engine?.biometric) && Number(candidate.score) >= MATCH_REVIEW_THRESHOLD;
}

const iso = () => new Date().toISOString();

/**
 * Whether a sighting's screen found a person in its main photo: the screen is
 * of the main photo (shared/routes/reports.js POST /found makes the photo that
 * shows a person the main one).
 */
function sightingScreenShowsPerson(sighting, photoId) {
  return photoId === MAIN_PHOTO && sightingScreenVerdict(sighting?.screening) === 'person';
}

/** A candidate as it is kept on the sighting. */
export function storedCandidate(candidate, rank, { source = 'forward', trigger = null } = {}) {
  const warnings = Array.isArray(candidate.warnings) && candidate.warnings.length ? candidate.warnings : null;
  return {
    reportId: candidate.report?.id || candidate.reportId,
    rank,
    status: 'proposed',
    score: Number(candidate.score) || 0,
    aarakshakScore: candidate.primaryScore ?? null,
    rekognitionScore: candidate.secondOpinionScore ?? null,
    corroborated: Boolean(candidate.corroborated),
    notChecked: Boolean(candidate.notChecked),
    notCheckedReason: candidate.notCheckedReason || null,
    secondOpinion: candidate.secondOpinion || null,
    enginesDisagree: candidate.enginesDisagree ?? null,
    engines: candidate.engines || null,
    enginesAnswered: Array.isArray(candidate.enginesAnswered) ? candidate.enginesAnswered : [],
    warnings,
    lowQuality: Boolean(candidate.lowQuality || warnings) || null,
    // Which photo of the sighting and which of the case the score is for
    // (shared/photo-set.js ids), so the officer looks at that pair first.
    photoPair: candidate.photoPair || null,
    source,
    trigger,
    proposedAt: iso(),
  };
}

/**
 * The sighting's top-level evidence fields, describing its current
 * candidate. They are what the queue sorts on and what older clients read.
 */
export function evidenceOf(candidate) {
  return {
    matchScore: candidate ? candidate.score : 0,
    primaryScore: candidate?.aarakshakScore ?? null,
    secondOpinionScore: candidate?.rekognitionScore ?? null,
    secondOpinionProvider: candidate && (candidate.rekognitionScore != null || candidate.notChecked) ? 'aws-rekognition' : null,
    secondOpinion: candidate?.secondOpinion || null,
    enginesDisagree: candidate?.enginesDisagree ?? null,
    matchCorroborated: candidate ? Boolean(candidate.corroborated) : null,
    matchNotChecked: candidate ? Boolean(candidate.notChecked) : null,
    photoQualityWarnings: candidate?.warnings || null,
    lowQualityPhoto: candidate?.lowQuality || null,
    matchedPhotoPair: candidate?.photoPair || null,
  };
}

/** The pool tally as it is kept on the record. */
function poolRecord(pool) {
  if (!pool || typeof pool !== 'object') return null;
  const keep = ['openWithPhotos', 'eligibleWithPhotos', 'compared', 'notCompared', 'sameDistrict', 'sameState', 'elsewhere', 'limit', 'source', 'indexHits', 'fromIndex', 'unindexed', 'foundChildIntakes'];
  return Object.fromEntries(keep.filter((key) => pool[key] !== undefined).map((key) => [key, pool[key]]));
}

/**
 * What a search was, kept on the record with its result: the engine that
 * answered, how much it compared, and the thresholds and configuration hash
 * it was judged under (shared/match-config.js).
 */
export function engineRecordOf(engine, { indexProvider = 'none', trigger = null } = {}) {
  const e = engine || {};
  const settings = e.settings || null;
  return {
    provider: e.provider || 'none',
    modelVersion: e.modelVersion || null,
    biometric: Boolean(e.biometric),
    // Survives even when every candidate was withheld, which is the case where
    // the queue would otherwise read as "nothing was found" when what actually
    // happened is "two engines looked and would not agree".
    corroborated: Boolean(e.corroborated),
    secondOpinion: e.secondOpinion || null,
    comparedAgainst: e.comparedAgainst ?? 0,
    // Comparisons that failed (an error, a timeout), as opposed to "no face".
    failedPairs: e.failedPairs ?? null,
    aarakshakAnswered: e.aarakshakAnswered ?? null,
    rekognitionAlone: e.rekognitionAlone ?? null,
    pool: poolRecord(e.pool),
    thresholds: e.thresholds || thresholdsOf(settings || {}),
    configHash: settings ? configHashOf(settings, indexProvider) : null,
    index: e.index || null,
    noFace: Boolean(e.noFace) || null,
    // Photo pairs compared beyond each record's first (shared/photo-set.js).
    extraPairs: e.extraPairs && (e.extraPairs.compared || e.extraPairs.stoppedForTime) ? e.extraPairs : null,
    sightingQuality: e.sightingQuality ?? null,
    qualityWarnings: Array.isArray(e.qualityWarnings) && e.qualityWarnings.length ? e.qualityWarnings : null,
    note: e.reason || e.note || null,
    trigger,
    searchedAt: iso(),
  };
}

/** The engine as an officer is told about it: no candidate, no score. */
export function engineSummary(engine) {
  if (!engine) return null;
  return {
    provider: engine.provider || 'none',
    modelVersion: engine.modelVersion || null,
    biometric: Boolean(engine.biometric),
    corroborated: Boolean(engine.corroborated),
    comparedAgainst: engine.comparedAgainst ?? 0,
    pool: engine.pool || null,
    index: engine.index || null,
    note: engine.reason || engine.note || null,
  };
}

/**
 * The jurisdiction the reporter gave (or their phone placed them in): where
 * the person was seen. A strong match overwrites the sighting's own state and
 * district with the matched case's, so this is kept separately. For a record
 * from before it was kept, only an unlinked sighting's own fields are the
 * reporter's; a linked one's are the case's (see below).
 */
export function reportedLocationOf(sighting) {
  if (sighting?.reportedLocation) return sighting.reportedLocation;
  // Before the field was kept, a link overwrote the sighting's own state and
  // district with the case's. A reverse link kept them on the link; a forward
  // link kept nothing, so where the person was seen is not known - the card
  // showed a sighting typed as "CBD Belapur" as seen in Ahmedabad, Gujarat.
  if (isReverseLinked(sighting)) {
    const previous = sighting.reverseMatch.previous;
    return { state: previous.state || null, district: previous.district || null };
  }
  if (sighting?.matchedReportId) return { state: null, district: null };
  return { state: sighting?.state || null, district: sighting?.district || null };
}

/**
 * The sighting fields a reverse link overwrites, as they were before it. Kept
 * on the link so that when the officer rejects it the sighting goes back
 * exactly where it was: its own district, the CWC or police workflow it was in.
 */
export const LINK_RESTORED_FIELDS = [
  'status', 'state', 'district', 'referralStatus', 'referredTo1098',
  'matchScore', 'primaryScore', 'secondOpinionScore', 'secondOpinionProvider', 'secondOpinion',
  'enginesDisagree', 'matchEngine', 'photoQualityWarnings', 'lowQualityPhoto', 'matchedPhotoPair',
];

export function previousSightingFields(sighting) {
  return Object.fromEntries(LINK_RESTORED_FIELDS.map((key) => [key, sighting[key] ?? null]));
}

/** A sighting whose current link to a case was made by the reverse search. */
export function isReverseLinked(sighting) {
  return Boolean(
    sighting?.matchedReportId &&
    sighting.reverseMatch?.previous &&
    sighting.reverseMatch.reportId === sighting.matchedReportId
  );
}

/** "Near the bus stand, Surat, Gujarat": a place, for an alert. */
export function placeText(foundLocation, { state, district } = {}) {
  return `${foundLocation}${state ? `, ${[district, state].filter(Boolean).join(', ')}` : ''}`;
}

/**
 * The candidate list of a sighting from before candidates were kept: its one
 * link, rebuilt from the evidence fields, so a legacy record walks too.
 */
function candidatesOf(sighting) {
  const list = Array.isArray(sighting?.matchCandidates)
    ? sighting.matchCandidates.filter((c) => c && typeof c === 'object' && c.reportId).map((c) => ({ ...c }))
    : [];
  if (sighting?.matchedReportId && !list.some((c) => c.reportId === sighting.matchedReportId)) {
    list.unshift({
      reportId: sighting.matchedReportId,
      rank: 1,
      status: 'proposed',
      score: Number(sighting.matchScore) || 0,
      aarakshakScore: sighting.primaryScore ?? null,
      rekognitionScore: sighting.secondOpinionScore ?? null,
      corroborated: sighting.secondOpinion === 'agrees',
      notChecked: sighting.secondOpinion === 'no_answer' || sighting.secondOpinion === 'not_checked',
      secondOpinion: sighting.secondOpinion || null,
      enginesDisagree: sighting.enginesDisagree ?? null,
      enginesAnswered: [],
      source: isReverseLinked(sighting) ? 'reverse' : 'forward',
      legacy: true,
    });
  }
  return list;
}

const rankOrder = (a, b) => Number(Boolean(b.corroborated)) - Number(Boolean(a.corroborated)) || (Number(b.score) || 0) - (Number(a.score) || 0);

export function createSightingMatcher(deps) {
  const {
    listReports, findReport, findFoundReport, listFoundReports,
    updateFoundReport, updateReport, listUsers,
    addNotification, addActivity, addAudit,
    readPhoto, rankMatches,
    rankSightingMatches = null,
    claimFoundReport = null,
    detectPerson = null,
    matchEngineInfo = null,
  } = deps;
  const faceIndex = safeFaceIndex(deps.faceIndex);

  /** A case a proposal may still point at. */
  const proposable = (reportId) => {
    const report = reportId ? findReport(reportId) : null;
    return report && isForwardPoolCase(report) ? report : null;
  };

  // ---- Alerts -----------------------------------------------------------------

  /** The police officers who can open a case: the only people told a sighting may match it. */
  function caseOfficers(report) {
    if (!report) return [];
    return listUsers().filter((u) => POLICE_ROLES.includes(u.role) && canAccessReport(u, report));
  }

  /**
   * Tells a case's police officers that a sighting may match it: where and
   * when, never who. Every other desk was told about the sighting when it
   * arrived, and is told nothing new now, or its inbox would say that it had
   * matched someone.
   */
  function alertCaseOfficers(sighting, report, body) {
    const officers = caseOfficers(report);
    const category = personCategoryOf(sighting);
    const title = category === 'woman'
      ? 'Possible match — woman spotted'
      : category === 'adult' ? 'Possible match — person spotted' : 'Possible match — child spotted';
    for (const recipient of officers) {
      addNotification({
        userId: recipient.id,
        kind: 'sighting_reported',
        title,
        body: seenOutsideCaseDistrict(sighting, report) ? `${body}${SEEN_OUTSIDE_HINT}` : body,
        priority: 'high',
        scope: { state: sighting.state, district: sighting.district, foundReportId: sighting.id, matched: true },
        inJurisdiction: !sighting.state || !recipient.jurisdiction?.state || recipient.jurisdiction.state === sighting.state,
      });
    }
    return officers;
  }

  // The place the reporter gave, not the case's district the sighting is filed
  // under once it is linked (reportedLocationOf in shared/routes/reports.js).
  const sightingWhere = (sighting) => placeText(sighting.foundLocation, sighting.reportedLocation || sighting);

  // ---- Writing a sighting safely ----------------------------------------------

  /**
   * Writes a patch to a sighting only if it is still what the search saw. On
   * the Worker the check and the write happen together against the database
   * (claimFoundReport): its store is a copy read when the request began,
   * seconds of comparisons ago. Express has one live store, where re-reading
   * the row just before writing is enough.
   */
  async function commitSighting(id, makePatch, isEligible) {
    if (typeof claimFoundReport === 'function') return claimFoundReport(id, makePatch, isEligible);
    const current = findFoundReport(id);
    if (!current || !isEligible(current)) return null;
    updateFoundReport(id, makePatch(current));
    return findFoundReport(id);
  }

  // ---- The forward search ------------------------------------------------------

  /**
   * Compares a sighting photo with the open cases. With an index provider
   * configured it first asks the index for its 50 closest faces and spends the
   * comparison budget on that shortlist (shared/match-pool.js); without one,
   * or when the index does not answer, on the nearest-first budget. Cases an
   * officer rejected for this sighting are never compared again.
   */
  async function forwardSearch(photo, { state = null, district = null, gender = null, ageApprox = null, excludeReportIds = [], probeId = MAIN_PHOTO, probeExtras = [], retryIndexWithExtras = false } = {}) {
    const excluded = new Set(excludeReportIds);
    const extras = (Array.isArray(probeExtras) ? probeExtras : []).filter((p) => p?.buffer?.length);
    // The sighting's other photos (shared/photo-set.js), compared only for
    // the cases most like its lead photo (shared/match-pipeline.js).
    const hints = { state, district, gender, ageApprox, excludeReportIds: [...excluded], probeId, probeExtras: extras };
    let index = null;
    if (photo?.length && faceIndex.enabled) {
      // The lead photo first. Another of the sighting's photos only when the
      // index gave no answer AND the caller says the lead's face was unclear:
      // then "no answer" is most likely "found no face", and the next photo
      // may have one. Otherwise no answer is the gallery's fault (a timeout, a
      // 5xx, its rate), and asking again would only spend more of its rate.
      // At most one search a photo.
      let hits = await faceIndex.search(photo, INDEX_TOP_K);
      for (const extra of retryIndexWithExtras ? extras : []) {
        if (Array.isArray(hits)) break;
        // eslint-disable-next-line no-await-in-loop
        hits = await faceIndex.search(extra.buffer, INDEX_TOP_K);
      }
      if (Array.isArray(hits)) {
        hints.shortlist = hits.map((hit) => hit.caseId);
        hints.indexProvider = faceIndex.name;
        index = { provider: faceIndex.name, topK: INDEX_TOP_K, hits: hits.length };
      } else {
        index = { provider: faceIndex.name, topK: INDEX_TOP_K, hits: null, error: 'no_answer' };
      }
    }
    const result = await rankMatches(photo || null, hints);
    const engine = { ...(result?.engine || { provider: 'none', biometric: false }), ...(index ? { index } : {}) };
    const candidates = (Array.isArray(result?.candidates) ? result.candidates : [])
      .filter((c) => c?.report?.id && !excluded.has(c.report.id));
    return { candidates, engine };
  }

  /** The proposals a search produced: the strong candidates, best first, at most five. */
  function proposalsOf(search, source, trigger) {
    return search.candidates
      .filter((c) => isStrongMatch(c, search.engine))
      .slice(0, MAX_MATCH_CANDIDATES)
      .map((c, i) => storedCandidate(c, i + 1, { source, trigger }));
  }

  /**
   * A sighting's candidate list after a new search: the new proposals, plus
   * any earlier proposal the new search did not look at (it fell outside the
   * budget, or came from the reverse search), re-ranked; then the history
   * (rejected and confirmed entries), which is never dropped.
   */
  function mergeCandidates(existing, fresh, comparedIds) {
    const compared = new Set(comparedIds || []);
    const freshIds = new Set(fresh.map((c) => c.reportId));
    const history = existing.filter((c) => c.status !== 'proposed' && !freshIds.has(c.reportId));
    const carried = existing.filter((c) => c.status === 'proposed' && !freshIds.has(c.reportId) && !compared.has(c.reportId));
    const proposed = [...fresh, ...carried]
      .filter((c) => proposable(c.reportId))
      .sort(rankOrder)
      .slice(0, MAX_MATCH_CANDIDATES)
      .map((c, i) => ({ ...c, rank: i + 1 }));
    return [...proposed, ...history];
  }

  /**
   * Where a sighting rests when it has no candidate left: back where a reverse
   * link found it (`reverseMatch.previous`), or at the reporter's own place in
   * the no-match queue - the CWC queue if an officer referred it there.
   */
  function restingFields(sighting, decision = null) {
    const referred = decision === 'refer_cwc' || Boolean(sighting.referredCwcAt);
    if (sighting.reverseMatch?.previous) {
      const previous = sighting.reverseMatch.previous;
      return {
        ...previous,
        reverseMatch: null,
        ...(decision === 'refer_cwc'
          ? { status: 'referred_cwc', referredTo1098: true, referralStatus: 'Referred to Childline/CWC' }
          : {}),
      };
    }
    const reported = reportedLocationOf(sighting);
    const adult = isAdultCategory(personCategoryOf(sighting));
    return {
      state: reported.state || null,
      district: reported.district || null,
      status: referred ? 'referred_cwc' : 'no_match',
      referralStatus: referred
        ? 'Referred to Childline/CWC'
        : adult ? 'Sent to the police' : 'Sent to Childline and the CWC',
      ...(referred ? { referredTo1098: true } : {}),
    };
  }

  /** The fields that put a sighting on a candidate: the case's jurisdiction, the review queue, the evidence. */
  function linkFieldsFor(candidate) {
    const report = findReport(candidate.reportId);
    return {
      matchedReportId: candidate.reportId,
      // The case's jurisdiction, so the officers who own the case are the ones
      // who see the sighting. `reportedLocation` keeps the reporter's own.
      state: report?.state || null,
      district: report?.district || null,
      status: 'pending_review',
      referralStatus: 'Police review pending',
      ...evidenceOf(candidate),
    };
  }

  /**
   * The patch a forward search makes to an existing sighting. A search in
   * which no face was compared changes nothing but the record of the attempt:
   * an outage must not unlink a sighting an officer is reviewing.
   */
  function forwardPatch(row, search, { trigger }) {
    const record = engineRecordOf(search.engine, { indexProvider: faceIndex.name, trigger });
    if (!search.engine?.biometric) return { matchEngine: record };
    const fresh = proposalsOf(search, 'forward', trigger);
    const merged = mergeCandidates(candidatesOf(row), fresh, search.engine.comparedIds);
    const current = merged.find((c) => c.status === 'proposed');
    if (current) return { matchCandidates: merged, ...linkFieldsFor(current), matchEngine: record };
    if (row.matchedReportId) return { matchCandidates: merged, ...restingFields(row), matchedReportId: null, ...evidenceOf(null), matchEngine: record };
    return { matchCandidates: merged, ...evidenceOf(null), matchEngine: record };
  }

  /**
   * The match fields of a sighting being created (POST /found): its candidate
   * list, its current candidate (or none) and the record of the search. The
   * caller fills in the queue fields for an unlinked sighting.
   */
  function newSightingFields(search, { trigger = 'submitted' } = {}) {
    const record = engineRecordOf(search.engine, { indexProvider: faceIndex.name, trigger });
    // Every candidate came out of the open-case pool moments ago
    // (shared/match-pool.js), so the search's own copy of the case is used.
    const strong = search.candidates.filter((c) => isStrongMatch(c, search.engine)).slice(0, MAX_MATCH_CANDIDATES);
    const proposals = strong.map((c, i) => storedCandidate(c, i + 1, { source: 'forward', trigger }));
    const current = proposals[0] || null;
    return {
      matchCandidates: proposals,
      matchedReportId: current ? current.reportId : null,
      matchedReport: current ? strong[0].report : null,
      currentCandidate: current,
      evidence: evidenceOf(current),
      matchEngine: record,
    };
  }

  /**
   * Runs the forward search again for a stored sighting (POST
   * /found/:id/rematch, a placement, the re-match batch). Returns
   * `{ ok, sighting, engine, linked }`, where `linked` says it now points at a
   * case it did not point at before; that case's police officers are alerted.
   */
  async function rematchSighting(sighting, { trigger = 'rematch', actor = null } = {}) {
    // Every photo of the sighting, its lead first (shared/photo-set.js).
    const lead = leadPhotoOf(sighting);
    const photos = lead ? await loadPhotos(sighting, readPhoto) : [];
    const photo = photos.find((p) => p.id === lead?.id)?.buffer || null;
    if (!photo) {
      // Recorded, so a re-match batch moves past it instead of retrying it forever.
      await commitSighting(sighting.id, () => ({ rematchAttemptedAt: iso() }), (row) => !row.anonymizedAt);
      return { ok: false, reason: 'The sighting photo could not be read.' };
    }
    const reported = reportedLocationOf(sighting);
    const [search, rescreen] = await Promise.all([
      forwardSearch(photo, {
        state: reported.state,
        district: reported.district,
        gender: sighting.gender || null,
        ageApprox: sighting.ageApprox ?? null,
        excludeReportIds: [...rejectedReportIds(sighting)],
        probeId: lead.id,
        probeExtras: photos.filter((p) => p.id !== lead.id && p.check?.verdict !== 'no_face'),
        retryIndexWithExtras: !(lead.check?.verdict === 'usable' || sightingScreenShowsPerson(sighting, lead.id)) && lead.check?.verdict !== 'no_face',
      }),
      rescreenMainPhoto(sighting, lead, photo),
    ]);
    const before = { status: sighting.status, matchedReportId: sighting.matchedReportId || null };
    const updated = await commitSighting(
      sighting.id,
      (row) => ({
        ...forwardPatch(row, search, { trigger }),
        ...(rescreen ? { screening: rescreenedScreening(row.screening, rescreen) } : {}),
      }),
      (row) => row.status === before.status && (row.matchedReportId || null) === before.matchedReportId && !row.anonymizedAt
    );
    if (!updated) return { ok: false, conflict: true, reason: 'The sighting changed while it was being compared. Open it again.' };
    const linked = Boolean(updated.matchedReportId && updated.matchedReportId !== before.matchedReportId);
    if (linked) {
      const report = findReport(updated.matchedReportId);
      addActivity({
        actor: 'Khozo matching',
        action: 'Linked a sighting to an open case for police review',
        target: updated.foundLocation,
        icon: 'upload',
        scope: { state: updated.state, district: updated.district, matchedReportId: updated.matchedReportId },
      });
      addAudit({
        actorId: actor?.id || null,
        actorName: actor?.name || 'Khozo matching',
        actorRole: actor?.role || 'system',
        action: 'sighting.forward_matched',
        targetType: 'foundReport',
        targetId: updated.id,
        summary: `Linked sighting ${updated.id} to case ${updated.matchedReportId} for police review`,
        scope: { matchedReportId: updated.matchedReportId, state: updated.state, district: updated.district },
        // Readable by the desks of the newly linked case; which case it
        // pointed at before is not theirs to know.
        metadata: { trigger, replacedEarlierLink: Boolean(before.matchedReportId), matchScore: updated.matchScore, matchEngine: updated.matchEngine },
      });
      alertCaseOfficers(updated, report, `A sighting at ${sightingWhere(updated)} may match a case.`);
    }
    return { ok: true, sighting: updated, engine: search.engine, linked, rescreened: rescreen?.verdict || null };
  }

  /**
   * Screens the main photo again when its screen never answered. When the
   * sighting arrived during an outage, or before an engine was configured,
   * the screen was stored as `unverified`, and nothing ran it again: the
   * review queue held the photo back as "Not screened" for good, even after
   * a later search had compared the face in it. Returns the new screen, or
   * null when there is nothing to do or still no answer. An officer's own
   * reading of the photo (`screening.officer`) is the verdict already and is
   * not second-guessed.
   */
  async function rescreenMainPhoto(sighting, lead, photo) {
    if (lead?.id !== MAIN_PHOTO || typeof detectPerson !== 'function') return null;
    if (sightingScreenVerdict(sighting.screening) !== 'unverified') return null;
    try {
      const screen = await detectPerson(photo);
      return screen && ['person', 'no_person'].includes(screen.verdict) ? screen : null;
    } catch (err) {
      console.warn('[matching] sighting photo screen failed:', err?.message || err);
      return null;
    }
  }

  /**
   * The sighting's screen with the answer in place of "no engine answered".
   * Whether the sighting raised the general alert when it arrived
   * (`raisesAlert`) is a decision already taken and stays as recorded; the
   * officers of a case it now matches are told by rematchSighting.
   */
  function rescreenedScreening(current, screen) {
    const { reason, ...kept } = current || {};
    return { ...kept, ...screen, firstCheckedAt: current?.checkedAt ?? null };
  }

  // ---- An officer's decision ---------------------------------------------------

  /**
   * "Not this person": the patch for rejecting (or referring on) a sighting's
   * current candidate. The candidate is marked rejected and recorded in
   * `rejectedLinks`; the sighting moves to the next proposed candidate, or
   * rests where it belongs (restingFields). Returns `{ patch, next }`.
   */
  function walkPatch(sighting, decision, user) {
    const now = iso();
    const currentId = sighting.matchedReportId;
    const wasReverse = isReverseLinked(sighting);
    const candidates = candidatesOf(sighting).map((c) => (
      c.reportId === currentId && c.status === 'proposed'
        ? { ...c, status: 'rejected', decision, decidedAt: now, decidedById: user.id, decidedByRole: user.role }
        : c
    ));
    const rejectedLinks = [
      ...(Array.isArray(sighting.rejectedLinks) ? sighting.rejectedLinks : []),
      {
        reportId: currentId,
        decision,
        trigger: wasReverse ? sighting.reverseMatch.trigger || null : sighting.matchEngine?.trigger || 'forward',
        direction: wasReverse ? 'reverse' : 'forward',
        matchScore: sighting.matchScore ?? null,
        linkedAt: wasReverse ? sighting.reverseMatch.matchedAt || null : sighting.matchEngine?.searchedAt || null,
        decidedAt: now,
        decidedById: user.id,
        decidedByRole: user.role,
      },
    ];
    // Proposals whose case has since been found, closed or anonymised are no
    // longer candidates for anyone.
    const kept = candidates.filter((c) => c.status !== 'proposed' || proposable(c.reportId));
    const next = kept.find((c) => c.status === 'proposed') || null;
    const referral = decision === 'refer_cwc' ? { referredTo1098: true, referredCwcAt: now } : {};
    if (next) {
      return {
        patch: { matchCandidates: kept, rejectedLinks, ...referral, ...linkFieldsFor(next) },
        next: findReport(next.reportId),
      };
    }
    return {
      patch: {
        matchCandidates: kept,
        rejectedLinks,
        ...referral,
        ...restingFields({ ...sighting, ...referral }, decision),
        matchedReportId: null,
        ...evidenceOf(null),
      },
      next: null,
    };
  }

  /** The candidate list with the current candidate marked confirmed. */
  function confirmedCandidates(sighting, user) {
    const now = iso();
    return candidatesOf(sighting).map((c) => (
      c.reportId === sighting.matchedReportId
        ? { ...c, status: 'confirmed', decidedAt: now, decidedById: user.id, decidedByRole: user.role }
        : c
    ));
  }

  // ---- The reverse search ------------------------------------------------------

  /**
   * The reverse search: compares a case's photo with the stored sightings
   * (and the open found-child intakes standing in for theirs) and links each
   * one the engines agree on, exactly as the forward search links a strong
   * match - the sighting moves to the Matches queue (`pending_review`,
   * `matchedReportId`), takes the case's jurisdiction so the case's officers
   * see it, and keeps the engines' evidence. The police officers who can open
   * the case are alerted, without being told who the person is; nobody else is
   * told anything new.
   *
   * What the link overwrote is kept on it (`reverseMatch.previous`): a
   * lookalike linked to a sighting a CWC desk was already following up must not
   * take that sighting away from them for good. An officer who rejects the link
   * restores it, and the same case is not proposed for it again.
   *
   * Runs inside the request, never after the response: the Worker's store
   * replica is flushed at the end of the request, so work left running after it
   * could be lost. A failure here never fails the request that triggered it.
   */
  async function matchStoredSightings(report, { trigger, actor, photo = null, photoId = null }) {
    const result = (sightingMatches, engine) => ({ sightingMatches, engine: engineSummary(engine) });
    if (!report?.photoFile || report.anonymizedAt) {
      return result(0, { provider: 'none', biometric: false, reason: 'The case has no photo to compare.' });
    }
    if (isFoundChildIntake(report)) {
      return result(0, { provider: 'none', biometric: false, reason: 'A found-child case is compared with missing cases as they are registered, not with sightings.' });
    }
    if (typeof rankSightingMatches !== 'function') {
      return result(0, { provider: 'none', biometric: false, reason: 'Reverse matching is not available on this runtime.' });
    }
    try {
      // The case's photos (shared/photo-set.js): the one given (`photoId`,
      // the main photo unless said) or the lead one compared with every
      // sighting, the others only with those most like it.
      const leadId = photo ? photoId || MAIN_PHOTO : leadPhotoOf(report)?.id || MAIN_PHOTO;
      const photos = await loadPhotos(report, readPhoto, photo ? { [leadId]: photo } : null);
      const casePhoto = photos.find((p) => p.id === leadId)?.buffer || photo || null;
      if (!casePhoto) return result(0, { provider: 'none', biometric: false, reason: 'The case photo could not be read.' });
      const { candidates, engine } = await rankSightingMatches(casePhoto, {
        state: report.state,
        district: report.district,
        reportId: report.id,
        subject: { gender: report.gender, age: report.age, dateOfMissing: report.dateOfMissing, createdAt: report.createdAt },
        probeId: leadId,
        // A case's group photo is never compared: a relative beside the
        // child would be matched as the child. Nor one with no face in it.
        probeExtras: photos.filter((p) => p.id !== leadId && !isBadFacePhoto(p)),
      });
      const record = engineRecordOf(engine, { indexProvider: faceIndex.name, trigger: `reverse:${trigger}` });

      const directEligible = (row) => isReverseMatchCandidate(row) && !wasLinkRejected(row, report.id);
      // A sighting reached through its found-child intake: the intake's photo
      // is the evidence, so the sighting's own retention and screen do not
      // rule it out; an officer's decisions still do.
      const viaIntakeEligible = (row) => Boolean(row) && !row.matchedReportId && !['matched', 'rejected'].includes(row.status) &&
        row.cwcFollowup?.outcome !== 'duplicate_or_invalid' && !wasLinkRejected(row, report.id);

      const linkPatch = (row, candidate, viaIntake) => {
        const proposal = storedCandidate(candidate, 1, { source: 'reverse', trigger });
        const history = candidatesOf({ ...row, matchedReportId: null }).filter((c) => c.status !== 'proposed' && c.reportId !== report.id);
        return {
          matchCandidates: [proposal, ...history],
          matchedReportId: report.id,
          state: report.state || null,
          district: report.district || null,
          status: 'pending_review',
          referralStatus: 'Police review pending',
          ...evidenceOf(proposal),
          matchEngine: record,
          reverseMatch: {
            reportId: report.id,
            trigger,
            previousStatus: row.status,
            previous: previousSightingFields(row),
            matchedAt: iso(),
            ...(viaIntake ? { viaIntakeReportId: viaIntake.id } : {}),
          },
        };
      };

      let linked = 0;
      for (const candidate of candidates) {
        if (!isStrongMatch(candidate, engine)) continue;
        const compared = candidate.sighting;
        const viaIntake = isFoundChildIntake(compared) ? compared : null;
        const targetId = viaIntake ? compared.sourceFoundReportId : compared?.id;
        const eligible = viaIntake ? viaIntakeEligible : directEligible;
        // Re-read rather than trust the ranking's snapshot: a sighting another
        // request linked, reviewed or anonymised meanwhile is not taken over.
        const current = targetId ? findFoundReport(targetId) : null;
        if (!current || !eligible(current)) continue;
        // eslint-disable-next-line no-await-in-loop
        const sighting = await commitSighting(current.id, (row) => linkPatch(row, candidate, viaIntake), eligible);
        if (!sighting) continue;
        addActivity({
          actor: 'Khozo matching',
          action: 'Linked an earlier sighting to a newly registered case for police review',
          target: sighting.foundLocation,
          icon: 'upload',
          scope: { state: sighting.state, district: sighting.district, matchedReportId: report.id },
        });
        addAudit({
          actorName: 'Khozo matching',
          actorRole: 'system',
          action: 'sighting.reverse_matched',
          targetType: 'foundReport',
          targetId: sighting.id,
          summary: `Linked earlier sighting ${sighting.id} to case ${report.id} for police review`,
          scope: { matchedReportId: report.id, state: sighting.state, district: sighting.district },
          metadata: {
            reportId: report.id,
            trigger,
            triggeredByRole: actor?.role || null,
            previousStatus: sighting.reverseMatch?.previousStatus || null,
            viaIntakeReportId: viaIntake?.id || null,
            matchScore: sighting.matchScore,
            matchEngine: sighting.matchEngine,
          },
        });
        alertCaseOfficers(sighting, report, `An earlier sighting at ${sightingWhere(sighting)} may match a newly registered case.`);
        linked += 1;
      }
      updateReport(report.id, {
        reverseSearch: {
          trigger,
          searchedAt: record.searchedAt,
          linked,
          provider: record.provider,
          biometric: record.biometric,
          comparedAgainst: record.comparedAgainst,
          pool: record.pool,
          thresholds: record.thresholds,
          configHash: record.configHash,
        },
      });
      return result(linked, engine);
    } catch (err) {
      console.warn('[matching] reverse sighting match failed:', err?.message || err);
      return result(0, { provider: 'none', biometric: false, reason: 'The comparison could not be completed.' });
    }
  }

  // ---- A case photo ------------------------------------------------------------

  /**
   * The person/face screen on a case photo: `{ faces, verdict }`, where the
   * verdict is `usable`, `no_face`, `multiple_faces` (a group photo: which face
   * is the person?) or `unchecked` (no engine answered). Never blocks
   * registration; the console flags a photo that cannot be matched.
   */
  async function checkCasePhoto(photo) {
    const checkedAt = iso();
    if (!photo?.length) return { faces: null, verdict: 'unchecked', provider: null, checkedAt };
    let screen = null;
    try {
      screen = typeof detectPerson === 'function' ? await detectPerson(photo) : null;
    } catch (err) {
      console.warn('[matching] case photo check failed:', err?.message || err);
    }
    if (!screen || !['person', 'no_person'].includes(screen.verdict)) {
      return { faces: null, verdict: 'unchecked', provider: screen?.provider || null, checkedAt };
    }
    const faces = Number.isFinite(Number(screen.faces)) ? Number(screen.faces) : null;
    const verdict = screen.verdict === 'no_person' || faces === 0 ? 'no_face' : faces > 1 ? 'multiple_faces' : 'usable';
    return {
      faces: verdict === 'no_face' ? 0 : faces,
      verdict,
      provider: screen.provider || null,
      quality: screen.quality ?? null,
      warnings: Array.isArray(screen.warnings) && screen.warnings.length ? screen.warnings : null,
      checkedAt,
    };
  }

  // ---- The one-to-many index ---------------------------------------------------

  /**
   * Adds an open, verified missing case's photos - the main one and its
   * extras (shared/photo-set.js) - to the index, when one is configured.
   * `photos` is bytes already in hand (loadPhotos); the rest are read.
   */
  async function indexCase(report, photos = null) {
    if (!faceIndex.enabled || !report?.photoFile || !isForwardPoolCase(report)) return null;
    return enrollCaseInIndex(faceIndex, report, await loadPhotos(report, readPhoto, photos), updateReport);
  }

  /** Takes a case out of the index: it was found, closed or anonymised. */
  async function unindexCase(report) {
    return removeCaseFromIndex(faceIndex, report, updateReport);
  }

  // ---- The re-match batch ------------------------------------------------------

  /** The configuration a search today would run under. */
  function currentSearch() {
    let info = null;
    try {
      info = typeof matchEngineInfo === 'function' ? matchEngineInfo() : null;
    } catch {
      info = null;
    }
    return {
      configHash: info?.settings ? configHashOf(info.settings, faceIndex.name) : null,
      budget: Number(info?.forwardBudget) || 25,
    };
  }

  /**
   * Whether a stored sighting's forward search should be run again:
   *   - its last search had no biometric answer (an outage, no engine
   *     configured, no face found by the engines then available);
   *   - its photo was never screened (no engine answered then), which holds
   *     it back in the review queue until a search screens it;
   *   - it compared fewer cases than the current budget would: comparisons
   *     failed (`failedPairs`), or the budget has been raised since and cases
   *     were left out (`pool.notCompared`);
   *   - it ran under other settings (`configHash`, shared/match-config.js).
   * Cases registered since are not a reason: the reverse search compared each
   * of them with this sighting when it was registered. A sighting under review
   * (linked to a case) is left to the officer's "Search again".
   */
  function needsRematch(sighting, current = currentSearch()) {
    if (!isRematchEligible(sighting) || sighting.matchedReportId) return false;
    const engine = sighting.matchEngine;
    if (!engine || !engine.biometric) return true;
    if (sightingScreenVerdict(sighting.screening) === 'unverified') return true;
    if (current.configHash && engine.configHash !== current.configHash) return true;
    if ((Number(engine.failedPairs) || 0) > 0) return true;
    const limit = Number(engine.pool?.limit);
    const leftOut = Number(engine.pool?.notCompared) || 0;
    return Number.isFinite(limit) && limit < current.budget && leftOut > 0;
  }

  /** The expected current age of a case, for the review screen. */
  const expectedAge = (report, at) => expectedAgeAt(report, at);

  return {
    faceIndex,
    isStrongMatch,
    caseOfficers,
    alertCaseOfficers,
    forwardSearch,
    newSightingFields,
    rematchSighting,
    walkPatch,
    confirmedCandidates,
    matchStoredSightings,
    checkCasePhoto,
    indexCase,
    unindexCase,
    currentSearch,
    needsRematch,
    expectedAge,
    engineSummary,
    listFoundReports,
    isPendingCitizenIntake,
  };
}
