// A scripted run of the whole app, for checking a build before it goes out:
//
//   KHOZO_DESKTOP_SMOKE=<folder for screenshots> [KHOZO_SMOKE_CASE=<case id> KHOZO_SMOKE_VIDEO=<file>
//   KHOZO_SMOKE_CAMERA=<place> KHOZO_SMOKE_START=<recording start>] electron .
//
// Signs in from KHOZO_LOGIN / KHOZO_PASSWORD (or the private helper's
// KHOZO_DEMO_*), saves a picture of each screen, and with a case and a video
// runs a real check through every step: reading, the first pass, Khozo's
// answer, the results, a frame and a clip. Then the app closes.
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSmoke({ win, out, signIn, jobs, getCase, probe, log }) {
  fs.mkdirSync(out, { recursive: true });
  const shot = async (name) => {
    await wait(500);
    // Every picture on the page loaded (or five seconds), so the screenshot shows what an officer sees.
    await win.webContents.executeJavaScript('Promise.race([Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.addEventListener("load", r); i.addEventListener("error", r); })))), new Promise((r) => setTimeout(r, 5000))])');
    await wait(400);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), image.toPNG());
    log(`smoke: saved ${name}`);
  };
  const run = (code) => win.webContents.executeJavaScript(code);
  const report = { steps: [] };
  const step = (name, ok, detail = '') => { report.steps.push({ name, ok, detail }); log(`smoke: ${ok ? 'ok' : 'FAIL'} ${name} ${detail}`); };
  const pictures = async (name) => {
    const list = await run('[...document.images].map((i) => ({ src: i.src.split("/").slice(2, 3).join(""), ok: i.complete && i.naturalWidth > 0 }))');
    const bad = list.filter((p) => !p.ok);
    step(`${name}: every picture shows`, list.length > 0 && bad.length === 0, `${list.length - bad.length} of ${list.length} (${bad.map((b) => b.src).join(', ')})`);
  };
  try {
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    // Shown without taking the focus: a hidden window does not paint new pictures.
    win.showInactive();
    await shot('01-start');
    await signIn();
    await run('window.__khozo.reload()');
    await shot('02-home');
    step('signed in', true);

    const caseId = process.env.KHOZO_SMOKE_CASE;
    const video = process.env.KHOZO_SMOKE_VIDEO;
    const existing = process.env.KHOZO_SMOKE_JOB && jobs().get(process.env.KHOZO_SMOKE_JOB) ? process.env.KHOZO_SMOKE_JOB : null;
    if (existing || (caseId && video)) {
      let id = existing;
      if (!id) {
        await run(`window.__khozo.newCheck(${JSON.stringify(caseId)})`);
        await shot('03-new-check');
        const info = await probe(video);
        const report0 = await getCase(caseId);
        id = jobs().create({
          report: report0,
          files: [{ path: video, name: path.basename(video), ...info, camera: process.env.KHOZO_SMOKE_CAMERA || 'Smoke test camera', recordedFrom: process.env.KHOZO_SMOKE_START || null }],
          settings: {},
        });
      }
      report.jobId = id;
      await run(`window.__khozo.showJob(${JSON.stringify(id)})`);
      await shot('04-running');
      const started = Date.now();
      let job = jobs().get(id);
      while (!['done', 'error', 'paused'].includes(job.status) && Date.now() - started < 15 * 60000) {
        await wait(1000);
        job = jobs().get(id);
      }
      step('the check finished', job.status === 'done', `${job.status} ${job.error || ''}`);
      step('people were seen', job.counts.people > 0, `${job.counts.people} people`);
      step('Khozo answered', job.counts.checked > 0, `${job.counts.checked} checked, ${job.counts.likely} likely, ${job.counts.possible} possible`);
      report.job = { status: job.status, counts: job.counts, model: job.model, toCheck: job.toCheck.map((p) => ({ key: p.key, verdict: p.verdict, closeness: p.closeness, clock: p.clock, time: p.time })) };
      await run(`window.__khozo.showJob(${JSON.stringify(id)})`);
      await shot('05-results');
      const shown = await run("({ chip: document.getElementById('job-chip')?.textContent.trim(), first: document.getElementById('tab-first')?.textContent, cards: document.querySelectorAll('.hit').length })");
      step('the results page shows the finished check and its faces', /Finished/.test(shown.chip || '') && (shown.first || '').includes(`(${job.toCheck.length})`) && shown.cards === job.toCheck.length, JSON.stringify(shown));
      await pictures('results');
      await run("window.__khozo.tab('everyone')");
      await shot('06-everyone');
      await pictures('everyone seen');
      await run("window.__khozo.tab('first')");
      const first = job.toCheck[0];
      if (first) {
        await run(`window.__khozo.openPerson(${JSON.stringify(first.key)})`);
        await wait(6000);
        await shot('07-player');
        const playing = await run("(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, error: v.error && v.error.code, w: v.videoWidth } : null; })()");
        step('the clip plays', Boolean(playing && playing.ready >= 2 && !playing.error), JSON.stringify(playing));
        await run('window.__khozo.closePerson()');
        await run(`window.__khozo.openFrame(${JSON.stringify(first.key)})`);
        await wait(2500);
        await shot('08-frame');
        const frame = await run("(() => { const i = document.querySelector('#frame-img'); return i ? { done: i.complete, w: i.naturalWidth } : null; })()");
        step('the full picture shows', Boolean(frame && frame.w > 0), JSON.stringify(frame));
      }
      if (process.env.KHOZO_SMOKE_KEEP !== '1') jobs().remove(id);
    }
  } catch (err) {
    step('smoke run', false, err.stack || err.message);
  } finally {
    fs.writeFileSync(path.join(out, 'smoke.json'), JSON.stringify(report, null, 2));
  }
}
