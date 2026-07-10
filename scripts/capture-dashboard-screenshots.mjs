import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('web/dist');
const outDir = resolve('docs/screenshots');
const port = 5174;
const api = 'http://localhost:4000';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let authToken = '';

const routes = [
  ['overview', '/app'],
  ['cases-firs', '/app/cases'],
  ['register-child-fir', '/app/register'],
  ['sightings-matches', '/app/matches'],
  ['cci-register', '/app/cci-register'],
  ['privacy-review', '/app/privacy'],
  ['audit-log', '/app/audit'],
  ['public-abuse', '/app/fraud'],
  ['mis-report', '/app/mis'],
  ['grievances', '/app/grievances'],
  ['network', '/app/network'],
];

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

async function proxy(req, res) {
  const upstream = await fetch(`${api}${req.url}`, {
    method: req.method,
    headers: { ...req.headers, host: 'localhost:4000' },
    body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req,
    duplex: 'half',
  });
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url || '/';
    if (url.startsWith('/api/')) return proxy(req, res);
    if (url.startsWith('/seed-auth')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><script>localStorage.setItem('khozo_token', ${JSON.stringify(authToken)}); location.replace('/app');</script>`);
      return;
    }
    const rawPath = decodeURIComponent(url.split('?')[0]);
    let file = rawPath === '/' ? join(root, 'index.html') : join(root, rawPath);
    if (!file.startsWith(root)) throw new Error('Bad path');
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(root, 'index.html');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types.get(extname(file)) || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err.stack || err));
  }
});

function chromeRun(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`Chrome exited ${code}: ${err}`)));
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const login = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@khozo.org', password: 'khozo123' }),
  });
  if (!login.ok) throw new Error(`Login failed ${login.status}: ${await login.text()}`);
  authToken = (await login.json()).token;

  await new Promise(resolveListen => server.listen(port, resolveListen));
  const userDataDir = resolve('.tmp/chrome-khozo-screens');
  const baseArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1050',
    '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw',
  ];

  await chromeRun([...baseArgs, '--virtual-time-budget=1500', '--dump-dom', `http://localhost:${port}/seed-auth`]).catch(() => {});

  for (const [name, route] of routes) {
    const file = resolve(outDir, `${name}.png`);
    await chromeRun([...baseArgs, '--virtual-time-budget=4200', `--screenshot=${file}`, `http://localhost:${port}${route}`]);
    console.log(file);
  }
}

main().finally(() => server.close());
