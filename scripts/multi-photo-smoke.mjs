/**
 * Checks several photos of one person (shared/photo-set.js): which photo a
 * record is compared on first, that a sighting is compared with every photo
 * of the cases most like it and the best pair kept, that the extra paid calls
 * stay inside their budget, and that the face search gallery is given a
 * case's photos together without ever being given a group photo.
 *
 * Providers are stubbed: a "photo" is the text FACE:<person> (or NOFACE, or
 * GROUP), and two photos of the same person score 0.9.
 *
 *   node scripts/multi-photo-smoke.mjs
 */
import process from 'node:process';

import { comparePhotos, extraPairBudgetOf, loadComparable, EXTRA_PAIR_BUDGET } from '../shared/match-pipeline.js';
import { enrollCaseInIndex, enrollablePhotos } from '../shared/face-index.js';
import {
  MAIN_PHOTO, extraPhotosView, leadPhotoOf, loadPhotos, photoCountOf, photoFilesOf, photosOf,
} from '../shared/photo-set.js';
import { anonymisedReportPatch } from '../shared/privacy.js';
import { anonymiseCase } from '../shared/retention.js';
import { photoNeedOf } from '../shared/photo-need.js';
import { citizenCaseView } from '../shared/case-domain.js';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const photo = (label) => Buffer.from(label);
const personIn = (buf) => /FACE:(\w+)/.exec(String(buf))?.[1] || null;

/** Aarakshak and Rekognition stand-ins that count every call. */
function providers({ rekognition = true } = {}) {
  const calls = { aarakshak: [], rekognition: [] };
  const score = (a, b) => {
    if (String(a).includes('NOFACE') || String(b).includes('NOFACE')) return { status: 'no_face' };
    return { status: 'answered', score: personIn(a) && personIn(a) === personIn(b) ? 0.9 : 0.1 };
  };
  return {
    calls,
    providers: {
      aarakshak: { ready: true, compare: async (a, b) => { calls.aarakshak.push([String(a), String(b)]); return score(a, b); } },
      rekognition: { ready: rekognition, compare: async (a, b) => { calls.rekognition.push([String(a), String(b)]); return score(a, b); } },
    },
  };
}

const extra = (id, label, check = null) => ({ id, file: `${label}.jpg`, check });
const record = (id, mainLabel, extras = [], more = {}) => ({
  id, photoFile: `${mainLabel}.jpg`, photoUrl: `/api/reports/photo/${id}`, status: 'missing',
  extraPhotos: extras.map(([pid, label, verdict]) => extra(pid, label, verdict ? { verdict } : null)), ...more,
});
// Files are named after what is in them: "FACE_A.jpg" holds FACE:A.
const readPhoto = async (file) => photo(String(file).replace(/\.jpg$/, '').replace('FACE_', 'FACE:'));

// ---- The photo set ------------------------------------------------------------

{
  const r = record('r_1', 'FACE_A', [['p_aaaa1111', 'FACE_A2', 'usable'], ['p_bbbb2222', 'NOFACE', 'no_face']]);
  const photos = photosOf(r);
  check('a record lists its main photo first, then its extras', photos.map((p) => p.id).join() === `${MAIN_PHOTO},p_aaaa1111,p_bbbb2222`);
  check('each extra is fetched under the record, by its id', photos[1].url === '/api/reports/photo/r_1?p=p_aaaa1111', photos[1].url);
  check('a view of the extras never shows the storage key', extraPhotosView(r).every((p) => !('file' in p)), JSON.stringify(extraPhotosView(r)));
  check('every file of a record is listed for deletion', photoFilesOf(r).join() === 'FACE_A.jpg,FACE_A2.jpg,NOFACE.jpg');
  check('an anonymised record has no photos', photosOf({ ...r, anonymizedAt: 1 }).length === 0 && photoCountOf({ ...r, anonymizedAt: 1 }) === 0);
  check('malformed extra entries are ignored', photoCountOf({ photoFile: 'x', extraPhotos: [null, { id: 'bad id', file: 'y' }, { id: 'p_ok123', file: '' }] }) === 1);

  check('the lead photo is the main one when its face check is fine', leadPhotoOf(r).id === MAIN_PHOTO);
  const groupMain = record('r_2', 'GROUP', [['p_cccc3333', 'FACE_B', 'usable']], { photoCheck: { verdict: 'multiple_faces' } });
  check('a group main photo gives the lead to a usable extra', leadPhotoOf(groupMain).id === 'p_cccc3333');
  const noBetter = record('r_3', 'NOFACE', [['p_dddd4444', 'NOFACE', 'no_face']], { photoCheck: { verdict: 'no_face' } });
  check('with no usable photo the main one still leads', leadPhotoOf(noBetter).id === MAIN_PHOTO);

  const loaded = await loadPhotos(r, readPhoto, { [MAIN_PHOTO]: photo('GIVEN') });
  check('photos already in hand are not read again', String(loaded[0].buffer) === 'GIVEN' && String(loaded[1].buffer) === 'FACE:A2', loaded.map((p) => String(p.buffer)).join());
}

// ---- Comparing with every photo -----------------------------------------------

{
  // Ten one-photo cases: exactly one call each, as before several photos.
  const { calls, providers: p } = providers();
  const stored = Array.from({ length: 10 }, (_, i) => record(`r_s${i}`, `FACE_S${i}`));
  const comparable = await loadComparable(stored, readPhoto, 5);
  const out = await comparePhotos({ photoBuf: photo('FACE:S3'), comparable, providers: p });
  check('one-photo records cost one comparison each, as before', calls.aarakshak.length === 10 && out.summary.extraPairs.compared === 0, `${calls.aarakshak.length} calls`);
  check('and the match names the pair it scored', out.candidates[0]?.report.id === 'r_s3' && out.candidates[0].photoPair?.case === MAIN_PHOTO && out.candidates[0].photoPair?.sighting === MAIN_PHOTO);
}

{
  // The case's main photo shows someone else; its second photo is the child.
  const { calls, providers: p } = providers();
  const stored = [
    record('r_target', 'FACE_OLD', [['p_eeee5555', 'FACE_K', 'usable']]),
    ...Array.from({ length: 8 }, (_, i) => record(`r_o${i}`, `FACE_O${i}`)),
  ];
  const comparable = await loadComparable(stored, readPhoto, 5);
  const out = await comparePhotos({ photoBuf: photo('FACE:K'), comparable, providers: p });
  const top = out.candidates[0];
  check('a case is found through its second photo', top?.report.id === 'r_target' && top.score >= 0.9, JSON.stringify(top && { id: top.report.id, score: top.score }));
  check('and the pair that matched is named', top?.photoPair?.case === 'p_eeee5555' && top.photoPair.sighting === MAIN_PHOTO, JSON.stringify(top?.photoPair));
  check('the second opinion is asked about that pair', calls.rekognition.some(([a, b]) => a === 'FACE:K' && b === 'FACE:K'), JSON.stringify(calls.rekognition));
  check('the extra pairs compared are counted', out.summary.extraPairs.compared === 1 && out.summary.extraPairs.improved === 1, JSON.stringify(out.summary.extraPairs));
  check('each record is counted once', out.summary.comparedIds.length === new Set(out.summary.comparedIds).size && out.summary.comparedAgainst === 9, JSON.stringify(out.summary.comparedIds));
  check('records not shortlisted are not compared again', calls.aarakshak.length === 10, `${calls.aarakshak.length} calls`);
}

{
  // A sighting's second photo shows the face its first one does not.
  const { providers: p } = providers();
  const stored = [record('r_m', 'FACE_M'), record('r_n', 'FACE_N')];
  const comparable = await loadComparable(stored, readPhoto, 5);
  const out = await comparePhotos({
    photoBuf: photo('NOFACE'),
    probeExtras: [{ id: 'p_ffff6666', buffer: photo('FACE:M') }],
    comparable,
    providers: p,
  });
  check('a sighting is matched through its second photo', out.candidates[0]?.report.id === 'r_m' && out.candidates[0].photoPair?.sighting === 'p_ffff6666', JSON.stringify(out.candidates[0]?.photoPair));
}

{
  // Reverse: the case is the probe; the pair is still named sighting / case.
  const { providers: p } = providers();
  const stored = [record('f_1', 'FACE_Q', [['p_gggg7777', 'FACE_R', 'usable']])];
  const comparable = await loadComparable(stored, readPhoto, 5);
  const out = await comparePhotos({ photoBuf: photo('FACE:R'), probeId: 'p_case0001', comparable, direction: 'reverse', providers: p });
  const pair = out.candidates[0]?.photoPair;
  check('the reverse search names the sighting photo and the case photo the right way round', pair?.sighting === 'p_gggg7777' && pair?.case === 'p_case0001', JSON.stringify(pair));
}

{
  // Many photos everywhere: the extra pairs stop at the budget.
  const { calls, providers: p } = providers();
  const stored = Array.from({ length: 12 }, (_, i) => record(`r_b${i}`, `FACE_B${i}`, [1, 2, 3, 4].map((n) => [`p_b${i}x${n}`, `FACE_C${i}${n}`, 'usable'])));
  const comparable = await loadComparable(stored, readPhoto, 5);
  const probeExtras = [{ id: 'p_probe0001', buffer: photo('FACE:Z1') }, { id: 'p_probe0002', buffer: photo('FACE:Z2') }];
  const out = await comparePhotos({ photoBuf: photo('FACE:Z0'), probeExtras, comparable, providers: p, extraPairBudget: 7 });
  check('the extra pairs stop at the budget', out.summary.extraPairs.compared === 7 && calls.aarakshak.length === 12 + 7, `${calls.aarakshak.length} calls, ${JSON.stringify(out.summary.extraPairs)}`);
  check('the second opinion still sees at most five pairs', calls.rekognition.length <= 5, `${calls.rekognition.length}`);

  const { calls: none, providers: q } = providers();
  await comparePhotos({ photoBuf: photo('FACE:Z0'), probeExtras, comparable, providers: q, extraPairBudget: 0 });
  check('a budget of 0 compares no other pair', none.aarakshak.length === 12, `${none.aarakshak.length}`);
  check('the budget is read as a whole number, 0 allowed', extraPairBudgetOf('0') === 0 && extraPairBudgetOf('') === EXTRA_PAIR_BUDGET && extraPairBudgetOf('x') === EXTRA_PAIR_BUDGET && extraPairBudgetOf('3.7') === 3);
}

// ---- The face search gallery ------------------------------------------------------

{
  const good = (id, label) => ({ id, buffer: photo(label), check: { verdict: 'usable' } });
  const list = [
    { id: MAIN_PHOTO, buffer: photo('GROUP'), check: { verdict: 'multiple_faces' } },
    good('p_1111aaaa', 'FACE:A'),
    { id: 'p_2222bbbb', buffer: photo('NOFACE'), check: { verdict: 'no_face' } },
    good('p_3333cccc', 'FACE:A2'),
  ];
  check('the gallery is never given a group photo or one with no face when better ones exist',
    enrollablePhotos(list).map((p) => p.id).join() === 'p_1111aaaa,p_3333cccc', enrollablePhotos(list).map((p) => p.id).join());
  check('a case with one photo still sends it, whatever its check said',
    enrollablePhotos([list[0]]).length === 1 && enrollablePhotos([list[0], list[2]]).map((p) => p.id).join() === MAIN_PHOTO);

  const sent = [];
  const refusesSets = {
    name: 'test', enabled: true,
    async enroll(caseId, photos) {
      sent.push(photos.length);
      return photos.length > 1 ? { ok: false, reason: 'multiple_faces' } : { ok: true, photos: [{ status: 'enrolled' }] };
    },
    async search() { return null; }, async remove() { return { ok: true }; }, async info() { return null; }, async listCaseIds() { return null; },
  };
  const updates = [];
  const entry = await enrollCaseInIndex(refusesSets, { id: 'r_idx' }, [good(MAIN_PHOTO, 'FACE:A'), good('p_1111aaaa', 'FACE:A2')], (id, patch) => updates.push(patch));
  check('a set refused for a photo is tried again with its first photo alone', sent.join() === '2,1' && entry.status === 'enrolled' && entry.photos.length === 1 && entry.photos[0].photoId === MAIN_PHOTO, JSON.stringify({ sent, entry }));
  check('and the outcome is written on the case', updates.at(-1)?.faceIndex?.status === 'enrolled');

  const legacy = await enrollCaseInIndex({ ...refusesSets, enroll: async (caseId, photos) => ({ ok: true, photos: photos.map(() => ({ status: 'enrolled', face_id: 'x' })) }) }, { id: 'r_old' }, photo('FACE:A'), null);
  check('a single photo given as bytes is enrolled as the main photo', legacy.photos[0].photoId === MAIN_PHOTO && legacy.status === 'enrolled');
}

// ---- What the review found, kept fixed ---------------------------------------------

{
  // A faceless main photo and extras not yet checked: the gallery would be
  // given the extras, so matching leads with one of them too.
  const r = record('r_lead', 'NOFACE', [['p_lead0001', 'FACE_L', null]], { photoCheck: { verdict: 'no_face' } });
  check('a faceless main photo gives the lead to an extra not yet checked', leadPhotoOf(r).id === 'p_lead0001');

  // Going forward the records are cases: a case's group photo or faceless
  // photo is never compared - a relative beside the child would match.
  const stored = [record('r_grp', 'FACE_G', [['p_grp00001', 'GROUP_G', 'multiple_faces'], ['p_nof00001', 'NOFACE', 'no_face'], ['p_ok000001', 'FACE_G2', 'usable']])];
  const forward = await loadComparable(stored, readPhoto, 5, { direction: 'forward' });
  check('a case\'s group and faceless photos are not compared', forward[0].extras.map((p) => p.id).join() === 'p_ok000001', JSON.stringify(forward[0].extras.map((p) => p.id)));
  const reverse = await loadComparable(stored, readPhoto, 5, { direction: 'reverse' });
  check('a sighting\'s group photo may still be compared (the child may be in it), never a faceless one',
    reverse[0].extras.map((p) => p.id).join() === 'p_grp00001,p_ok000001', JSON.stringify(reverse[0].extras.map((p) => p.id)));
}

{
  // Other photos are read only for the pairs the budget lets run.
  const reads = [];
  const counting = async (file) => { reads.push(file); return readPhoto(file); };
  const stored = Array.from({ length: 6 }, (_, i) => record(`r_rd${i}`, `FACE_R${i}`, [1, 2, 3, 4].map((n) => [`p_rd${i}x${n}`, `FACE_RX${i}${n}`, 'usable'])));
  const comparable = await loadComparable(stored, counting, 5);
  const leadReads = reads.length;
  const { providers: p } = providers();
  await comparePhotos({ photoBuf: photo('FACE:R0'), comparable, providers: p, extraPairBudget: 3 });
  check('only the photos the budget lets be compared are read', leadReads === 6 && reads.length - leadReads === 3, `${leadReads} lead reads, ${reads.length - leadReads} more`);
}

{
  // No new extra pair starts after the time allowed.
  let clock = 0;
  const { calls, providers: p } = providers();
  const slow = { ...p, aarakshak: { ready: true, compare: async (a, b) => { clock += 6000; return p.aarakshak.compare(a, b); } } };
  const stored = Array.from({ length: 5 }, (_, i) => record(`r_tm${i}`, `FACE_T${i}`, [1, 2, 3].map((n) => [`p_tm${i}x${n}`, `FACE_TX${i}${n}`, 'usable'])));
  const comparable = await loadComparable(stored, readPhoto, 5);
  const out = await comparePhotos({ photoBuf: photo('FACE:T0'), comparable, providers: slow, concurrency: 1, extraPairTimeMs: 15000, now: () => clock });
  check('extra pairs stop being started once the time allowed has passed',
    out.summary.extraPairs.stoppedForTime > 0 && calls.aarakshak.length < 5 + 15, JSON.stringify({ calls: calls.aarakshak.length, extra: out.summary.extraPairs }));
}

{
  const bad = { id: 'p_bad00001', buffer: photo('GROUP'), check: { verdict: 'multiple_faces' } };
  check('a group photo is never sent to the gallery alone', enrollablePhotos([bad]).length === 0);
  check('a lone faceless main photo still is, as before', enrollablePhotos([{ id: MAIN_PHOTO, buffer: photo('NOFACE'), check: { verdict: 'no_face' } }]).length === 1);
  const twice = await enrollCaseInIndex({
    name: 'test', enabled: true,
    async enroll(caseId, photos) { return photos.length > 1 ? { ok: false, reason: 'face_too_small' } : { ok: true, photos: [{ status: 'enrolled' }] }; },
    async search() { return null; }, async remove() { return { ok: true }; }, async info() { return null; }, async listCaseIds() { return null; },
  }, { id: 'r_att' }, [{ id: MAIN_PHOTO, buffer: photo('FACE:A'), check: null }, { id: 'p_att00001', buffer: photo('FACE:A2'), check: null }], null);
  check('a retried enrolment says it took two calls', twice.attempts === 2, JSON.stringify(twice));
}

{
  const refusedButUsable = {
    photoFile: 'a', photoCheck: { verdict: 'no_face' },
    extraPhotos: [{ id: 'p_usable01', file: 'b', check: { verdict: 'usable' } }],
    faceIndex: { status: 'failed', reason: 'face_too_small' },
  };
  check('a case the gallery refused still needs a better photo, whatever the checks said', photoNeedOf(refusedButUsable) === 'weak');

  const view = citizenCaseView({
    id: 'r_fam', registeredById: 'u_parent', photoUrl: '/api/reports/photo/r_fam', photoFile: 'r_fam.jpg',
    extraPhotos: [
      { id: 'p_family01', file: 'f1', addedById: 'u_parent', check: { verdict: 'usable' } },
      { id: 'p_police01', file: 'f2', addedById: 'u_police', check: { verdict: 'usable' } },
    ],
  });
  check('a family sees the photos it gave, not those the police added, and no check',
    view.extraPhotos.length === 1 && view.extraPhotos[0].id === 'p_family01' && !('check' in view.extraPhotos[0]), JSON.stringify(view.extraPhotos));
}

// ---- Anonymising deletes every photo ---------------------------------------------

{
  const r = record('r_anon', 'FACE_A', [['p_hhhh8888', 'FACE_A2', 'usable'], ['p_iiii9999', 'FACE_A3', 'usable']], { childName: 'Smoke', parentName: 'Smoke' });
  const deleted = [];
  const store = { ...r };
  await anonymiseCase({ updateReport: (id, patch) => Object.assign(store, patch), deletePhoto: async (file) => deleted.push(file), faceIndex: null }, r);
  check('anonymising a case deletes its main photo and every extra', deleted.join() === 'FACE_A.jpg,FACE_A2.jpg,FACE_A3.jpg', deleted.join());
  check('and leaves no extra photo on the record', Array.isArray(store.extraPhotos) && store.extraPhotos.length === 0 && anonymisedReportPatch(r).extraPhotos.length === 0);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Multi-photo checks passed.');
