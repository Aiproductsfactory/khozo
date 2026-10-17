import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/*
 * Pages that must open with no signal, precached by the service worker with
 * everything they import: the sighting form, tracking a sighting, and the home
 * page. The officer console, charts, the bulk importer and the language
 * dictionaries are cached when first used instead (web/public/sw.js).
 */
const OFFLINE_PAGES = ['src/pages/Capture.jsx', 'src/pages/TrackSighting.jsx', 'src/pages/Landing.jsx'];
const NOT_PRECACHED = (chunk) =>
  /^(?:locale-|charts)/.test(chunk.name) || /\/src\/(?:dashboard|bulk)\//.test(slash(chunk.facadeModuleId || ''));
// No `$`: a Windows checkout may end the line with \r\n.
const BUILD_LINE = /^const BUILD = \{ version: 'dev', precache: \[\] \};/m;

function slash(path) {
  return path.replace(/\\/g, '/');
}

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

/*
 * Writes this build's version and offline file list into the copied sw.js
 * (the `const BUILD = …` line). The version is a hash of every file in the
 * build, so any change to the app gives the worker new bytes: browsers then
 * install it, it fetches the new shell, and the old build's caches are
 * deleted when it activates.
 */
function khozoServiceWorker() {
  return {
    name: 'khozo-service-worker',
    apply: 'build',
    async writeBundle(options, bundle) {
      const outDir = options.dir;
      const swPath = join(outDir, 'sw.js');
      let sw;
      try {
        sw = await readFile(swPath, 'utf8');
      } catch {
        this.warn('sw.js is not in the build output; the service worker was not stamped.');
        return;
      }
      if (!BUILD_LINE.test(sw)) this.error('web/public/sw.js must contain the line: const BUILD = { version: \'dev\', precache: [] };');

      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const files = new Set();
      const visit = (chunk) => {
        if (!chunk || files.has(chunk.fileName) || NOT_PRECACHED(chunk)) return;
        files.add(chunk.fileName);
        for (const css of chunk.viteMetadata?.importedCss || []) files.add(css);
        for (const imported of chunk.imports) visit(byFile.get(imported));
      };
      chunks.filter((chunk) => chunk.isEntry).forEach(visit);
      for (const page of OFFLINE_PAGES) {
        const chunk = chunks.find((c) => slash(c.facadeModuleId || '').endsWith(`/${page}`));
        if (chunk) visit(chunk);
        else this.warn(`No chunk for ${page}; it will not open offline until first visited.`);
      }

      const all = (await listFiles(outDir)).sort();
      const icons = all.filter((file) => /^icons\/[^/]+\.(?:png|svg)$/.test(file));
      const precache = [
        '/',
        ...(all.includes('manifest.webmanifest') ? ['/manifest.webmanifest'] : []),
        ...icons.map((file) => `/${file}`),
        ...[...files].sort().map((file) => `/${file}`),
      ];

      const hash = createHash('sha256');
      for (const file of all) {
        hash.update(`${file}\0`);
        hash.update(file === 'sw.js' ? sw : await readFile(join(outDir, file)));
      }
      const version = hash.digest('hex').slice(0, 12);
      await writeFile(swPath, sw.replace(BUILD_LINE, `const BUILD = ${JSON.stringify({ version, precache })};`));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), khozoServiceWorker()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React and the router are named first: otherwise Rollup folds them
          // into the charts chunk (recharts imports React), and every page,
          // /report included, downloads the charts library to get React.
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return 'vendor';
          if (id.includes('/node_modules/recharts/')) return 'charts';
          // One file per language, fetched only when that language is chosen
          // (web/src/i18n.jsx). English is the key and needs no dictionary.
          const locale = /\/src\/locales\/([a-z]{2})\//.exec(id);
          if (locale) return `locale-${locale[1]}`;
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
