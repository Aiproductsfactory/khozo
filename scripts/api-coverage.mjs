/**
 * Checks that every API path the web and mobile clients call is actually served.
 *
 * This is the check that was missing. The Worker build had been hand-ported
 * from the Express API and had fallen ~40 endpoints behind it, so the deployed
 * demo answered 404 to the public sighting upload — the product's single most
 * important flow — while every unit-level test still passed, because nothing
 * compared what the clients ask for against what the API registers.
 *
 * It is deliberately static: the client call sites are read out of the source,
 * the route table is read out of the shared routers, and the two are compared.
 * No server, no database and no network, so it runs in CI and before a deploy.
 *
 *   node scripts/api-coverage.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import registerAuthRoutes from '../shared/routes/auth.js';
import registerReportRoutes from '../shared/routes/reports.js';
import registerDashboardRoutes from '../shared/routes/dashboard.js';
import registerGrievanceRoutes from '../shared/routes/grievances.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- What the API serves ---------------------------------------------------

/** Collects registrations without running any handler. */
function collectRoutes() {
  const found = [];
  const recorder = (basePath) => {
    const router = {
      use: () => router,
      ...Object.fromEntries(
        ['get', 'post', 'put', 'patch', 'delete'].map((method) => [
          method,
          (routePath) => {
            found.push({
              method: method.toUpperCase(),
              path: `${basePath}${routePath === '/' ? '' : routePath}` || basePath,
            });
            return router;
          },
        ])
      ),
    };
    return router;
  };

  // Every dependency is a stub: registration must not touch storage or config.
  const deps = new Proxy(
    { settings: {}, upload: { single: () => () => {} } },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      },
    }
  );

  registerAuthRoutes(recorder('/auth'), deps);
  registerReportRoutes(recorder('/reports'), deps);
  registerDashboardRoutes(recorder('/dashboard'), deps);
  registerGrievanceRoutes(recorder('/grievances'), deps);
  found.push({ method: 'GET', path: '/health' });

  return found;
}

// ---- What the clients call -------------------------------------------------

function sourceFiles(dir, extensions = ['.js', '.jsx']) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (extensions.includes(path.extname(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Reduces a call site to a comparable route: interpolations and query strings
 * become a single `:param` segment, matching how the routers declare them.
 */
function normalisePath(raw) {
  let value = raw.trim();
  if (!value.startsWith('/')) return null;
  // An interpolation that does not follow a "/" is a query string the client
  // builds inline (`/reports${query(filters)}`), not a path segment.
  value = value.replace(/(?<!\/)\$\{[^}]*\}/g, '');
  value = value.split('?')[0];
  value = value.replace(/\$\{[^}]*\}/g, ':param');
  value = value.replace(/\/+$/, '') || '/';
  return value;
}

const WEB_CALL = /\bapi\.(get|post|postForm|blob)\(\s*[`'"]([^`'"]+)[`'"]/g;
const MOBILE_CALL = /\brequest\(\s*[`'"]([^`'"]+)[`'"]([^)]*)\)/g;

function webCalls() {
  const calls = [];
  for (const file of sourceFiles(path.join(root, 'web', 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, kind, rawPath] of source.matchAll(WEB_CALL)) {
      const normalised = normalisePath(rawPath);
      if (!normalised) continue;
      calls.push({
        method: kind === 'get' || kind === 'blob' ? 'GET' : 'POST',
        path: normalised,
        client: 'web',
        file: path.relative(root, file),
      });
    }
  }
  return calls;
}

function mobileCalls() {
  const calls = [];
  for (const file of sourceFiles(path.join(root, 'mobile', 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, rawPath, options] of source.matchAll(MOBILE_CALL)) {
      const normalised = normalisePath(rawPath);
      if (!normalised) continue;
      const method = /method:\s*'(\w+)'/.exec(options || '')?.[1] || 'GET';
      calls.push({
        method: method.toUpperCase(),
        path: normalised,
        client: 'mobile',
        file: path.relative(root, file),
      });
    }
  }
  return calls;
}

// The mobile sighting upload builds its FormData across several statements, so
// its endpoint is not a literal argument the scanner can see.
const EXTRA_CALLS = [
  { method: 'POST', path: '/reports/found', client: 'mobile', file: 'mobile/src/services/api.js' },
];

// ---- Comparison ------------------------------------------------------------

/** True when a client path fits a registered route pattern. */
function matches(routePath, callPath) {
  const routeParts = routePath.split('/');
  const callParts = callPath.split('/');
  if (routeParts.length !== callParts.length) return false;
  return routeParts.every((part, i) => {
    // A route parameter accepts any segment; a literal route segment is only
    // satisfied by the same literal, never by a value the client interpolates.
    if (part.startsWith(':')) return true;
    return part === callParts[i];
  });
}

const routes = collectRoutes();
const calls = [...webCalls(), ...mobileCalls(), ...EXTRA_CALLS];

const seen = new Set();
const unique = calls.filter((call) => {
  const key = `${call.method} ${call.path} ${call.client}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const missing = unique.filter(
  (call) => !routes.some((route) => route.method === call.method && matches(route.path, call.path))
);

console.log(`Khozo API coverage\n  ${routes.length} routes registered\n  ${unique.length} client call sites checked\n`);

if (missing.length) {
  console.log('Client calls with no matching API route:\n');
  for (const call of missing) {
    console.log(`  ${call.client.padEnd(7)} ${call.method.padEnd(5)} ${call.path.padEnd(48)} ${call.file}`);
  }
  console.log(`\n${missing.length} unserved call site(s). These are 404s in the running app.`);
  process.exit(1);
}

const byClient = unique.reduce((acc, call) => {
  acc[call.client] = (acc[call.client] || 0) + 1;
  return acc;
}, {});
console.log(`API coverage checks passed (${Object.entries(byClient).map(([k, v]) => `${k}: ${v}`).join(', ')}).`);
