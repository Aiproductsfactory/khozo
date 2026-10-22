/**
 * The two face-match engines must behave the same.
 *
 * Khozo runs on two runtimes: the Cloudflare Worker (worker/src/match.js, a
 * signed fetch to Rekognition) and the Node build (server/src/match.js, the
 * AWS SDK). They used to implement the rules around the providers separately
 * and drifted: one fell back to Rekognition when Aarakshak found no face and
 * the other did not; one dropped a candidate Rekognition never answered for and
 * the other passed it through as if confirmed.
 *
 * Here both engines are pointed at the same two stand-in providers - a fake
 * Aarakshak and a fake Rekognition, local HTTP servers, no real face and no
 * network - and every scenario must produce the same candidates, the same
 * per-candidate engine record and the same engine summary on both:
 *
 *   - two engines agree: corroborated, the lower score kept
 *   - Rekognition disagrees: withheld
 *   - the engines disagree only when they land on different sides of their
 *     own match lines, never because their numbers are far apart
 *   - Aarakshak finds no face: Rekognition compares alone (no veto)
 *   - Rekognition errors, or cannot read a WebP: kept, flagged "not checked"
 *   - Rekognition unconfigured: an uncorroborated lead
 *   - the reverse search sends the sighting photo as the source
 *   - the face screen counts faces and asks the second engine
 *   - both report the same settings, so the same configuration hash
 *
 *   node scripts/match-engine-parity-smoke.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
};

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const photo = (person, role, head = JPEG_HEAD) => Buffer.concat([head, Buffer.from(`FACE:${person}:${role};`)]);
const facesIn = (text) => [...text.matchAll(/FACE:(\w+):(\w+);/g)].map((m) => ({ person: m[1], role: m[2], marker: m[0] }));

// What the stand-ins do, by the person in the photo.
const behaviour = {
  aarakshakNoFace: new Set(['N']),
  rekognitionDisagrees: new Set(['Q']),
  rekognitionFails: new Set(['E']),
  groups: new Set(['G']),
  // Aarakshak's score for the same person, where it is not 0.9: S is the
  // 20 Oct 2026 pair (0.72 beside Rekognition's 100), L is below its 0.35 line.
  aarakshakScores: { S: 0.72, L: 0.2 },
  rekognitionCertain: new Set(['S']),
};
const calls = { aarakshak: [], rekognition: [] };

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const fakeAarakshak = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const faces = facesIn(Buffer.concat(chunks).toString('latin1'));
    calls.aarakshak.push(faces.map((f) => f.role));
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-api-key'] !== 'parity-key') return send(401, { detail: 'invalid key' });
    if (faces.length < 2 || faces.some((f) => behaviour.aarakshakNoFace.has(f.person))) return send(422, { detail: 'No detectable face in one of the images' });
    const same = faces[0].person === faces[1].person;
    const group = faces.some((f) => behaviour.groups.has(f.person));
    return send(200, {
      score: same ? behaviour.aarakshakScores[faces[0].person] ?? 0.9 : 0.02,
      source_faces: group ? [{}, {}] : [{}],
      target_faces: [{}],
      source_quality_score: 0.8,
      target_quality_score: 0.8,
    });
  });
});

const fakeRekognition = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const send = (status, body, type = null) => {
      res.writeHead(status, { 'Content-Type': 'application/x-amz-json-1.1', ...(type ? { 'x-amzn-errortype': `${type}:` } : {}) });
      res.end(JSON.stringify(body));
    };
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(400, { __type: 'SerializationException', message: 'bad body' }, 'SerializationException');
    }
    const decode = (b64) => facesIn(Buffer.from(b64 || '', 'base64').toString('latin1'))[0];
    const source = decode(body.SourceImage?.Bytes);
    const target = decode(body.TargetImage?.Bytes);
    calls.rekognition.push([source?.role, target?.role]);
    if (!source || !target) return send(400, { __type: 'InvalidParameterException', message: 'There are no faces in the image.' }, 'InvalidParameterException');
    if ([source, target].some((f) => behaviour.rekognitionFails.has(f.person))) {
      return send(500, { __type: 'InternalServerError', message: 'stand-in failure' }, 'InternalServerError');
    }
    const self = source.marker === target.marker;
    const same = source.person === target.person;
    const sameScore = behaviour.rekognitionDisagrees.has(source.person) ? 40 : behaviour.rekognitionCertain.has(source.person) ? 100 : 95;
    const similarity = self ? 100 : same ? sameScore : 0;
    const box = { Width: 0.5, Height: 0.5, Left: 0.25, Top: 0.25 };
    return send(200, {
      SourceImageFace: { BoundingBox: box, Confidence: 99.9 },
      FaceMatches: similarity > 0 ? [{ Similarity: similarity, Face: { BoundingBox: box, Confidence: 99.9 } }] : [],
      UnmatchedFaces: similarity > 0 ? (behaviour.groups.has(target.person) ? [{ BoundingBox: box, Confidence: 99 }] : []) : [{ BoundingBox: box, Confidence: 99 }],
    });
  });
});

const aarakshakPort = await listen(fakeAarakshak);
const rekognitionPort = await listen(fakeRekognition);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'khozo-parity-smoke-'));

// Both engines read their configuration per call, from here.
const ENV = {
  AARAKSHAK_API_URL: `http://127.0.0.1:${aarakshakPort}/api/v1/compare`,
  AARAKSHAK_API_KEY: 'parity-key',
  AARAKSHAK_TIMEOUT_MS: '5000',
  AWS_ACCESS_KEY_ID: 'AKIAPARITYSMOKE',
  AWS_SECRET_ACCESS_KEY: 'parity-secret',
  AWS_REGION: 'ap-south-1',
  KHOZO_REKOGNITION_ENDPOINT: `http://127.0.0.1:${rekognitionPort}`,
  KHOZO_DATA_DIR: dataDir,
  KHOZO_ENV_FILE: path.join(dataDir, 'no.env'),
  DATABASE_URL: '',
};
for (const key of ['AWS_SESSION_TOKEN', 'AWS_PROFILE', 'KHOZO_MATCH_CANDIDATES', 'KHOZO_REVERSE_MATCH_CANDIDATES', 'KHOZO_REKOGNITION_CONFIRM', 'KHOZO_SECOND_OPINION_TOP_N', 'AARAKSHAK_THRESHOLD', 'AARAKSHAK_GALLERY_URL', 'AARAKSHAK_GALLERY_KEY']) delete process.env[key];
Object.assign(process.env, ENV);
// The AWS SDK retries a 5xx with backoff; keep the run quick.
process.env.AWS_MAX_ATTEMPTS = '1';

const worker = await import('../worker/src/match.js');
const server = await import('../server/src/match.js');
const { configHashOf } = await import('../shared/match-config.js');
const { enginesDisagreeOn } = await import('../shared/match-verdict.js');

const store = new Map();
const readPhoto = async (key) => store.get(key) || null;
const caseRow = (id, person, extra = {}) => {
  store.set(`${id}.jpg`, photo(person, 'case'));
  return { id, status: 'missing', state: 'Gujarat', district: 'Ahmedabad', photoFile: `${id}.jpg`, ...extra };
};
const sightingRow = (id, person) => {
  store.set(`${id}.jpg`, photo(person, 'sighting'));
  return { id, status: 'no_match', state: 'Gujarat', district: 'Ahmedabad', photoFile: `${id}.jpg`, createdAt: Date.now() - 1000, screening: { verdict: 'person' } };
};
const cases = [caseRow('r_A', 'A'), caseRow('r_B', 'B'), caseRow('r_Q', 'Q'), caseRow('r_N', 'N'), caseRow('r_E', 'E'), caseRow('r_S', 'S'), caseRow('r_L', 'L')];
const sightings = [sightingRow('f_A', 'A'), sightingRow('f_B', 'B')];
const hints = { state: 'Gujarat', district: 'Ahmedabad' };

/** What must agree: everything but timings. */
function comparable(result) {
  return {
    candidates: result.candidates.map((c) => ({
      id: (c.report || c.sighting)?.id,
      score: c.score,
      primaryScore: c.primaryScore,
      secondOpinionScore: c.secondOpinionScore,
      secondOpinion: c.secondOpinion,
      corroborated: c.corroborated,
      confirmed: c.confirmed,
      notChecked: c.notChecked,
      notCheckedReason: c.notCheckedReason || null,
      enginesDisagree: c.enginesDisagree,
      engines: c.engines,
      enginesAnswered: c.enginesAnswered,
    })),
    engine: {
      provider: result.engine.provider,
      biometric: result.engine.biometric,
      comparedAgainst: result.engine.comparedAgainst,
      failedPairs: result.engine.failedPairs ?? null,
      corroborated: result.engine.corroborated ?? null,
      secondOpinion: result.engine.secondOpinion ?? null,
      noFace: result.engine.noFace ?? null,
      thresholds: result.engine.thresholds,
      settings: result.engine.settings,
      pool: result.engine.pool,
    },
  };
}

async function both(label, run) {
  const w = await run('worker');
  const s = await run('server');
  const same = isDeepStrictEqual(comparable(w), comparable(s));
  check(`${label}: the Worker and the Node build agree`, same, same ? '' : `\n      worker ${JSON.stringify(comparable(w))}\n      server ${JSON.stringify(comparable(s))}`);
  return w;
}

const forward = (sightingPhoto) => (runtime) => (runtime === 'worker'
  ? worker.rankMatches({}, sightingPhoto, hints, { reports: cases, readPhoto })
  : server.rankMatches(sightingPhoto, hints, { reports: cases, readPhoto }));
const candidateFor = (result, id) => result.candidates.find((c) => (c.report || c.sighting)?.id === id);

const quiet = console.warn;
console.warn = () => {};
try {
  console.log('Khozo face-match engine parity\n');

  const agreed = await both('two engines agree', forward(photo('A', 'sighting')));
  const a = candidateFor(agreed, 'r_A');
  check('a face both engines agree on is corroborated, at the lower of the two scores',
    a?.corroborated === true && a.score === 0.9 && a.secondOpinionScore === 0.95 && a.enginesAnswered.join() === 'aarakshak,rekognition', JSON.stringify(a));

  const disagreed = await both('Rekognition disagrees', forward(photo('Q', 'sighting')));
  check('a face Rekognition does not confirm is withheld', !candidateFor(disagreed, 'r_Q') && disagreed.engine.secondOpinion?.withheld >= 1, JSON.stringify(disagreed.engine.secondOpinion));

  const scales = await both('Aarakshak 0.72 beside Rekognition 1.00', forward(photo('S', 'sighting')));
  const sc = candidateFor(scales, 'r_S');
  check('two scores far apart that both clear their own lines are not a disagreement',
    sc?.corroborated === true && sc.primaryScore === 0.72 && sc.secondOpinionScore === 1 && sc.enginesDisagree === false, JSON.stringify(sc));

  const split = await both('Aarakshak below its line, Rekognition above', forward(photo('L', 'sighting')));
  const sp = candidateFor(split, 'r_L');
  check('one engine above its own line and the other below is a disagreement', sp?.enginesDisagree === true && sp.primaryScore === 0.2, JSON.stringify(sp));

  const lines = { aarakshak: 0.35, rekognitionConfirm: 0.8 };
  check('the rule reads each score against its own line',
    enginesDisagreeOn({ aarakshakScore: 0.72, rekognitionScore: 1 }, lines) === false
      && enginesDisagreeOn({ aarakshakScore: 0.2, rekognitionScore: 0.95 }, lines) === true
      && enginesDisagreeOn({ aarakshakScore: 0.6, rekognitionScore: 0.4 }, lines) === true
      && enginesDisagreeOn({ aarakshakScore: 0.02, rekognitionScore: 0 }, lines) === false);
  check('and says nothing when a score or a line is missing',
    enginesDisagreeOn({ aarakshakScore: 0.72, rekognitionScore: null }, lines) === null
      && enginesDisagreeOn({ aarakshakScore: 0.72, rekognitionScore: 1 }, {}) === null
      && enginesDisagreeOn({ aarakshakScore: 0.72, rekognitionScore: 1 }, { aarakshak: null, rekognitionConfirm: 0.8 }) === null);

  const noVeto = await both('Aarakshak finds no face', forward(photo('N', 'sighting')));
  const n = candidateFor(noVeto, 'r_N');
  check('Aarakshak finding no face is no veto: Rekognition compares alone',
    n?.secondOpinion === 'sole_engine' && n.score === 0.95 && n.engines.aarakshak === 'no_face' && noVeto.engine.provider === 'aws-rekognition', JSON.stringify(n));

  const failing = await both('Rekognition errors', forward(photo('E', 'sighting')));
  const e = candidateFor(failing, 'r_E');
  check('a candidate Rekognition errors on is kept, flagged "not checked"',
    e?.notChecked === true && e.notCheckedReason === 'no_answer' && e.corroborated === false && e.confirmed === false, JSON.stringify(e));

  const webp = await both('a WebP sighting', forward(photo('A', 'sighting', WEBP_HEAD)));
  const w = candidateFor(webp, 'r_A');
  check('a WebP is "not checked" by Rekognition, which cannot read it', w?.notChecked === true && w.notCheckedReason === 'unsupported_format', JSON.stringify(w));

  const saved = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  const single = await both('Rekognition not configured', forward(photo('A', 'sighting')));
  const lone = candidateFor(single, 'r_A');
  check('with one engine configured, a candidate is an uncorroborated lead',
    lone?.secondOpinion === 'unavailable' && lone.corroborated === false && lone.notChecked === false && single.engine.settings.rekognition === null, JSON.stringify(lone));
  process.env.AWS_ACCESS_KEY_ID = saved.id;
  process.env.AWS_SECRET_ACCESS_KEY = saved.secret;

  calls.aarakshak.length = 0;
  calls.rekognition.length = 0;
  const reverse = await both('the reverse search', (runtime) => (runtime === 'worker'
    ? worker.rankSightingMatches({}, photo('A', 'case'), hints, { foundReports: sightings, reports: [], readPhoto })
    : server.rankSightingMatches(photo('A', 'case'), hints, { foundReports: sightings, reports: [], readPhoto })));
  check('the reverse search corroborates the same pair', candidateFor(reverse, 'f_A')?.corroborated === true);
  check('and both engines are always sent the sighting photo first',
    [...calls.aarakshak, ...calls.rekognition].every((roles) => roles[0] === 'sighting' && roles[1] === 'case'),
    JSON.stringify([...calls.aarakshak, ...calls.rekognition].slice(0, 6)));

  // Faces from a video, each compared with one case (POST /reports/:id/video-search).
  calls.aarakshak.length = 0;
  calls.rekognition.length = 0;
  const frames = ['A', 'B', 'Q', 'N', 'E'].map((person, id) => ({ id, buffer: photo(person, 'sighting') }));
  const frameRuns = {};
  for (const runtime of ['worker', 'server']) {
    const casePhoto = photo('A', 'case');
    // eslint-disable-next-line no-await-in-loop
    frameRuns[runtime] = runtime === 'worker'
      ? await worker.compareFramesWithCase({}, casePhoto, frames, { reviewThreshold: 0.35 })
      : await server.compareFramesWithCase(casePhoto, frames, { reviewThreshold: 0.35 });
  }
  const frameView = (run) => ({ engines: run.engines, results: run.results.map(({ id, verdict, aarakshakScore, rekognitionScore, engines }) => ({ id, verdict, aarakshakScore, rekognitionScore, engines })) });
  check('faces from a video: the Worker and the Node build agree', isDeepStrictEqual(frameView(frameRuns.worker), frameView(frameRuns.server)),
    `\n      worker ${JSON.stringify(frameView(frameRuns.worker))}\n      server ${JSON.stringify(frameView(frameRuns.server))}`);
  check('faces from a video: the person is likely, a stranger unlikely',
    frameRuns.worker.results[0]?.verdict === 'likely' && frameRuns.worker.results[1]?.verdict === 'unlikely', JSON.stringify(frameRuns.worker.results.map((r) => r.verdict)));
  check('faces from a video: the face from the video is always the source',
    [...calls.aarakshak, ...calls.rekognition].every((roles) => roles[0] === 'sighting' && roles[1] === 'case'));

  const screens = [];
  for (const [label, buf, expect] of [
    ['a group photo', photo('G', 'case'), (r) => r.verdict === 'person' && r.faces === 2],
    ['a face only Rekognition sees', photo('N', 'case'), (r) => r.verdict === 'person' && r.provider === 'aws-rekognition'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const fromWorker = await worker.detectPerson({}, buf);
    // eslint-disable-next-line no-await-in-loop
    const fromServer = await server.detectPerson(buf);
    const strip = ({ checkedAt, ...rest }) => rest;
    check(`the face screen on ${label}: both agree`, isDeepStrictEqual(strip(fromWorker), strip(fromServer)), `${JSON.stringify(fromWorker)} vs ${JSON.stringify(fromServer)}`);
    check(`the face screen on ${label}`, expect(fromWorker), JSON.stringify(fromWorker));
    screens.push(fromWorker);
  }

  const wInfo = worker.matchEngineInfo({});
  const sInfo = server.matchEngineInfo();
  check('both report the same settings, so the same configuration hash',
    isDeepStrictEqual(wInfo.settings, sInfo.settings) && configHashOf(wInfo.settings) === configHashOf(sInfo.settings),
    `${JSON.stringify(wInfo.settings)} vs ${JSON.stringify(sInfo.settings)}`);
} finally {
  console.warn = quiet;
  fakeAarakshak.close();
  fakeRekognition.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n--- ${checks.length - failed.length}/${checks.length} checks passed ---`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? `  — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('Match engine parity checks passed.');
process.exit(0);
