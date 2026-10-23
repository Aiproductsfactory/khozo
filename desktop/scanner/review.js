// The review sheet a run leaves beside its pictures: the people to look at
// first, closest first, and everyone seen, in time order. A plain page that
// opens from the folder with no internet; nothing in it leaves the laptop.
import path from 'node:path';
import { formatVideoTime } from '../../web/src/video/faces.js';
import { FRAME_VERDICTS } from '../../shared/video-search.js';

export const VERDICT_WORDS = {
  likely: 'Likely the same person',
  possible: 'Possibly the same person',
  not_agreed: 'The two checks did not agree',
  unlikely: 'Unlikely to be the same person',
  no_face: 'No clear face',
  no_answer: 'Not checked yet',
};

const SHORT_WORDS = {
  likely: 'Likely', possible: 'Possibly', not_agreed: 'Did not agree', unlikely: 'Unlikely', no_face: 'No clear face', no_answer: 'Not checked',
};

/** The answers worth an officer's look, in the order they are shown. */
export const TO_CHECK = ['likely', 'possible', 'not_agreed'];

const SLICE_SECONDS = 15 * 60;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (from, file) => path.relative(from, file).split(path.sep).map(encodeURIComponent).join('/');

/** The clock time of a moment in a video that started at `recordedFrom`, or null. */
export function clockTime(recordedFrom, seconds, style = { dateStyle: 'medium', timeStyle: 'medium' }) {
  const start = Date.parse(recordedFrom || '');
  if (!Number.isFinite(start)) return null;
  return new Date(start + seconds * 1000).toLocaleString('en-IN', style);
}

/** Everyone a run looked at, with their answer and closeness, ready to sort and show. */
export function peopleOf(manifest, run) {
  const people = [];
  for (const record of manifest.files) {
    const fileRun = run.files?.[record.sha256] || {};
    for (const track of record.tracks) {
      people.push({
        record,
        track,
        recordedFrom: fileRun.recordedFrom || record.recordedFrom || null,
        verdict: fileRun.answers?.[track.id]?.verdict || null,
        closeness: fileRun.scores?.[track.id] ?? null,
      });
    }
  }
  return people;
}

/** The people to look at first: likely, then possibly, then where the checks disagreed; closest, then clearest, first. */
export function toCheckFirst(people) {
  const rank = (v) => FRAME_VERDICTS.indexOf(v);
  return people
    .filter((p) => TO_CHECK.includes(p.verdict))
    .sort((a, b) => rank(a.verdict) - rank(b.verdict) || (b.closeness ?? -2) - (a.closeness ?? -2) || b.track.quality - a.track.quality);
}

function when(p) {
  const clock = clockTime(p.recordedFrom, p.track.time);
  return `${esc(formatVideoTime(p.track.time))} into the video${clock ? `, <b>${esc(clock)}</b> on its clock` : ''}`;
}

/** The review sheet as one HTML page, for a run saved in `scanDir`. */
export function reviewPage({ scanDir, manifest, run }) {
  const people = peopleOf(manifest, run);
  const first = toCheckFirst(people);
  const checked = people.filter((p) => p.verdict && p.verdict !== 'no_answer').length;
  const count = (v) => people.filter((p) => p.verdict === v).length;
  const tooSmall = manifest.files.reduce((n, f) => n + (f.facesTooSmall || 0), 0);
  const model = run.model ? `${esc(run.model.name)} ${esc(run.model.version)}` : null;

  const card = (p) => `
<article class="card ${esc(p.verdict)}">
  <img src="${link(scanDir, path.join(p.record.outDir, p.track.picture))}" alt="Face seen at ${esc(formatVideoTime(p.track.time))}">
  <div>
    <p class="verdict">${esc(VERDICT_WORDS[p.verdict] || '')}</p>
    <p>${when(p)}</p>
    <p>${esc(p.record.name)}${p.track.seen > 1 ? `, in view ${esc(formatVideoTime(p.track.firstTime))} to ${esc(formatVideoTime(p.track.lastTime))}` : ''}</p>
    ${p.closeness != null ? `<p class="quiet">Closeness on this laptop: ${p.closeness.toFixed(2)}${model ? ` (${model})` : ''}</p>` : ''}
    ${p.track.frame ? `<p><a href="${link(scanDir, path.join(p.record.outDir, p.track.frame))}">See full picture</a></p>` : ''}
  </div>
</article>`;

  const everyone = manifest.files.map((record) => {
    const own = people.filter((p) => p.record === record).sort((a, b) => a.track.time - b.track.time);
    const slices = new Map();
    for (const p of own) {
      const k = Math.floor(p.track.time / SLICE_SECONDS);
      if (!slices.has(k)) slices.set(k, []);
      slices.get(k).push(p);
    }
    const sliceHtml = [...slices.entries()].map(([k, list]) => {
      const from = k * SLICE_SECONDS;
      const to = from + SLICE_SECONDS;
      const style = { timeStyle: 'short' };
      const clockFrom = clockTime(list[0].recordedFrom, from, style);
      const label = clockFrom ? `${clockFrom} to ${clockTime(list[0].recordedFrom, to, style)}` : `${formatVideoTime(from)} to ${formatVideoTime(to)}`;
      const faces = list.map((p) => `<figure><img loading="lazy" src="${link(scanDir, path.join(record.outDir, p.track.picture))}" alt=""><figcaption>${esc(formatVideoTime(p.track.time))}${p.verdict ? ` <span class="tag ${esc(p.verdict)}">${esc(SHORT_WORDS[p.verdict])}</span>` : ''}</figcaption></figure>`).join('');
      return `<h4>${esc(label)} <span class="quiet">(${list.length} ${list.length === 1 ? 'person' : 'people'})</span></h4><div class="grid">${faces}</div>`;
    }).join('');
    return `<h3>${esc(record.name)} <span class="quiet">(${own.length} people)</span></h3>${sliceHtml || '<p>No one was seen in this video.</p>'}`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faces to check: case ${esc(run.caseId)}</title>
<style>
:root{--ink:#1d2433;--quiet:#5b6475;--line:#d9dee7;--bg:#f5f7fa;--card:#fff;--likely:#b45309;--possible:#1d4ed8;--other:#64748b}
body{margin:0;font:15px/1.5 system-ui,"Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#0f2a4a;color:#fff;padding:16px 20px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;opacity:.85}
main{max-width:1100px;margin:auto;padding:16px}
.note{background:#fff8e1;border:1px solid #f0d080;border-radius:8px;padding:10px 14px}
.counts{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.counts div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.card{display:flex;gap:14px;background:var(--card);border:1px solid var(--line);border-left:6px solid var(--other);border-radius:10px;padding:12px;margin:10px 0}
.card.likely{border-left-color:var(--likely)}.card.possible{border-left-color:var(--possible)}
.card img{width:160px;height:160px;object-fit:cover;border-radius:6px;background:#ddd}.card p{margin:2px 0}
.verdict{font-weight:700;font-size:17px}.quiet{color:var(--quiet);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px;text-align:center}
figure img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px}figcaption{font-size:12px;color:var(--quiet)}
.tag{display:inline-block;font-size:11px;font-weight:700;color:#fff;background:var(--other);border-radius:8px;padding:0 6px}.tag.likely{background:var(--likely)}.tag.possible{background:var(--possible)}
h4{margin:16px 0 6px}
</style></head><body>
<header><h1>Faces to check for case ${esc(run.caseId)}</h1><p>${esc(run.camera || '')}${run.updatedAt ? ` · checked ${esc(new Date(run.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}` : ''}</p></header>
<main>
<p class="note">Every result here is a lead, not an identification. Look at the face, and at the video at that moment, before any action.</p>
<div class="counts"><div><b>${people.length}</b> people seen</div><div><b>${checked}</b> checked on Khozo</div><div><b>${count('likely')}</b> likely</div><div><b>${count('possible')}</b> possibly</div><div><b>${tooSmall}</b> faces too small to use</div></div>
<h2>Look at these first</h2>
${first.length ? first.map(card).join('') : '<p>No face was close enough to the case. Look through everyone seen below.</p>'}
<h2>Everyone seen</h2>
${everyone}
</main></body></html>
`;
}
