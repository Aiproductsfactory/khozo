// A newer Khozo Desktop (spec F23): Khozo says which version is out, what
// changed and the installer's SHA-256 (GET /dashboard/desktop-version). With a
// link, the app fetches the installer, checks it against that fingerprint, and
// on the officer's word closes and runs it; the jobs carry on after. Without a
// link, it tells the officer to ask their nodal officer. Free of Electron, so
// it can be tested on its own.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Whether version `a` ("0.2.3") is newer than `b`. */
export function isNewer(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/**
 *   getClient()       the signed-in Khozo client
 *   currentVersion    this app's version
 *   downloadsDir      where installers are fetched to
 *   launch(file)      runs the installer and closes the app
 *   onChange()        the state changed; the window asks for it again
 */
export function createUpdates({ getClient, currentVersion, downloadsDir, launch, onChange = () => {}, onPolicy = () => {}, log = () => {}, fetchImpl = globalThis.fetch }) {
  let state = null; // { version, notes, sha256, downloadUrl, stage, progress, error, file }
  const set = (patch) => { state = state ? { ...state, ...patch } : patch; onChange(); };

  return {
    /** Asks Khozo for the newest version; quietly does nothing when Khozo cannot be reached. */
    async check() {
      let latest;
      try { latest = await getClient()?.desktopVersion(); } catch { return state; }
      // What Khozo lets this app do (shared/desktop-policy.js), kept by the caller for when there is no internet.
      if (latest?.policy) onPolicy(latest.policy);
      if (!latest?.version || !isNewer(latest.version, currentVersion)) return state;
      // Already being fetched, or fetched: keep that.
      if (state?.version === latest.version && state.stage !== 'failed') return state;
      set({ version: latest.version, notes: latest.notes || '', sha256: latest.sha256 || null, downloadUrl: latest.downloadUrl || null, stage: 'available', progress: 0, error: null, file: null });
      log(`Khozo Desktop ${latest.version} is out (this is ${currentVersion})`);
      return state;
    },

    /** Fetches the installer and checks its fingerprint. */
    async download() {
      if (!state || !['available', 'failed'].includes(state.stage)) return state;
      if (!state.downloadUrl) throw new Error('There is no link to this version. Ask your nodal officer for it.');
      // An installer that cannot be checked is not run.
      if (!state.sha256) throw new Error('Khozo did not say what this version\'s fingerprint is, so it cannot be checked.');
      set({ stage: 'downloading', progress: 0, error: null });
      fs.mkdirSync(downloadsDir, { recursive: true });
      const file = path.join(downloadsDir, `Khozo-Desktop-Setup-${state.version}.exe`);
      const part = `${file}.part`;
      try {
        const res = await fetchImpl(state.downloadUrl, { redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}`);
        const total = Number(res.headers.get('content-length')) || 0;
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(part);
        let received = 0;
        let lastShown = 0;
        for await (const chunk of res.body) {
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          received += chunk.length;
          if (total && received - lastShown > total / 100) {
            lastShown = received;
            set({ progress: Math.min(0.99, received / total) });
          }
        }
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
        if (hash.digest('hex') !== state.sha256) {
          fs.rmSync(part, { force: true });
          throw new Error('The downloaded file is not the one Khozo described (its fingerprint does not match), so it was deleted.');
        }
        fs.renameSync(part, file);
        set({ stage: 'ready', progress: 1, file });
        log(`Fetched and checked Khozo Desktop ${state.version}`);
      } catch (err) {
        fs.rmSync(part, { force: true });
        set({ stage: 'failed', error: err.message });
      }
      return state;
    },

    /** Closes the app and runs the checked installer. */
    install() {
      if (state?.stage !== 'ready' || !state.file || !fs.existsSync(state.file)) throw new Error('Download the new version first.');
      return launch(state.file);
    },

    /** The update as the window shows it. */
    view() {
      return state && { version: state.version, notes: state.notes, stage: state.stage, progress: state.progress, error: state.error, canDownload: Boolean(state.downloadUrl && state.sha256) };
    },
  };
}
