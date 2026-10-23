/**
 * A signed installer, so Windows shows who made Khozo Desktop instead of
 * warning about an unknown publisher (spec D5).
 *
 *   node build/sign.mjs        (npm run dist:signed)
 *
 * The certificate is one of:
 *   KHOZO_SIGN_PFX + KHOZO_SIGN_PASSWORD   a code-signing certificate file (.pfx)
 *   KHOZO_SIGN_THUMBPRINT                  a certificate in this Windows user's store
 *                                          (an EV certificate on a USB token shows up there)
 * KHOZO_SIGN_TIMESTAMP is the time-stamping server (default DigiCert's), so a
 * signature stays valid after the certificate expires; "none" signs without one.
 *
 * Steps: build the app; let electron-builder make the program folder only;
 * sign the program; make the installer from that signed folder; sign the
 * installer; check both signatures. Signing uses Windows' own
 * Set-AuthenticodeSignature, not electron-builder's tools, whose download
 * this office's network blocks. KHOZO_FACE_MODEL is passed through, as for
 * `npm run dist`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const env = process.env;
const pfx = env.KHOZO_SIGN_PFX;
const thumbprint = env.KHOZO_SIGN_THUMBPRINT;
const timestamp = env.KHOZO_SIGN_TIMESTAMP || 'http://timestamp.digicert.com';
if (!pfx && !thumbprint) {
  console.error('Set KHOZO_SIGN_PFX and KHOZO_SIGN_PASSWORD, or KHOZO_SIGN_THUMBPRINT, to sign. See desktop/README.md.');
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: desktop, stdio: 'inherit', env, shell: process.platform === 'win32' && cmd === 'npx' });
const powershell = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env }).trim();
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

const certificate = pfx
  // The password goes in through the environment, never on a command line.
  // (Windows PowerShell 5.1's Get-PfxCertificate takes no password, so .NET reads the file.)
  ? `$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(${quote(path.resolve(pfx))}, $env:KHOZO_SIGN_PASSWORD)`
  : `$c = Get-ChildItem Cert:\\CurrentUser\\My\\${thumbprint.replace(/[^A-Fa-f0-9]/g, '')}`;

function sign(file) {
  const ts = timestamp === 'none' ? '' : ` -TimestampServer ${quote(timestamp)}`;
  const status = powershell(`${certificate}; if (-not $c) { throw 'No certificate' }; (Set-AuthenticodeSignature -FilePath ${quote(file)} -Certificate $c -HashAlgorithm SHA256${ts}).Status`);
  console.log(`signed ${path.basename(file)}: ${status}`);
}

function check(file) {
  const out = powershell(`$s = Get-AuthenticodeSignature -FilePath ${quote(file)}; "$($s.Status)|$($s.SignerCertificate.Subject)"`);
  const [status, subject] = out.split('|');
  if (!subject) throw new Error(`${path.basename(file)} is not signed`);
  console.log(`${path.basename(file)}: ${status}, signed by ${subject}`);
  return status;
}

run(process.execPath, ['build/build.mjs']);
run('npx', ['electron-builder', '--win', 'dir', '--x64']);
const program = path.join(desktop, 'release', 'win-unpacked', `${pkg.build.productName}.exe`);
sign(program);
run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--prepackaged', path.join(desktop, 'release', 'win-unpacked')]);
const installer = path.join(desktop, 'release', pkg.build.nsis.artifactName.replace('${version}', pkg.version));
sign(installer);
const statuses = [check(program), check(installer)];
// "Valid" needs a certificate Windows trusts; a test certificate signs, but reads "UnknownError".
if (statuses.some((s) => s !== 'Valid')) console.log('Note: Windows does not trust this certificate, so SmartScreen will still warn. A certificate from a public authority is needed for that.');
