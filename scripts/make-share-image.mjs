/**
 * Renders web/public/assets/share-default.jpg — the picture WhatsApp, Facebook,
 * LinkedIn and X show when someone shares khozo.org, and the fallback for a
 * child's appeal that has no photograph.
 *
 * 1200x630 is the 1.91:1 card every one of them crops to. It stays a JPEG well
 * under 300 KB because WhatsApp silently drops the image from a preview above
 * that, leaving the bare domain this was written to replace.
 *
 *   node scripts/make-share-image.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web/public/assets/share-default.jpg');

const INK = '#1c2530';
const KHOZO = '#67a426';
const LIME = '#bef264';
const SANS = "'Segoe UI', 'Inter', Arial, sans-serif";
const DEVANAGARI = "'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', sans-serif";

// The same hand glyph as the Logo component, scaled up.
const HAND =
  'M12 2a1 1 0 0 1 1 1v7h1V4a1 1 0 1 1 2 0v6h1V6a1 1 0 1 1 2 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6.3-3.9L3 16.2A1.5 1.5 0 0 1 5.4 14.4L7 16V5a1 1 0 1 1 2 0v6h1V3a1 1 0 0 1 1-1z';

/*
 * Everything is centred. WhatsApp shows the card cropped — about 12% off each
 * side in a chat, a centre square in a compact preview — so text set against
 * the left edge lost its first letters. The headline is sized to fit inside
 * the centre 630px square on its own.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${INK}"/>
  <circle cx="90" cy="70" r="230" fill="${KHOZO}" opacity="0.09"/>
  <circle cx="1120" cy="590" r="230" fill="${KHOZO}" opacity="0.09"/>

  <g transform="translate(482 58)">
    <rect width="76" height="76" rx="18" fill="${KHOZO}"/>
    <g transform="translate(16 16) scale(1.8)"><path d="${HAND}" fill="#fff"/></g>
    <text x="96" y="40" font-family="${SANS}" font-size="38" font-weight="800" fill="#fff" letter-spacing="-0.5">KHOZO</text>
    <text x="97" y="72" font-family="${DEVANAGARI}" font-size="25" font-weight="700" fill="${LIME}">खोज़ो</text>
  </g>

  <text text-anchor="middle" font-family="${SANS}" font-weight="800" fill="#fff" font-size="64" letter-spacing="-1.5">
    <tspan x="600" y="250">Seen a child who</tspan>
    <tspan x="600" y="324">may be missing?</tspan>
  </text>
  <text text-anchor="middle" font-family="${SANS}" font-size="28" fill="#ffffff" fill-opacity="0.78">
    <tspan x="600" y="390">Send a photo from your phone in under a minute.</tspan>
    <tspan x="600" y="430">An officer checks every report before a family is contacted.</tspan>
  </text>

  <g transform="translate(374 474)">
    <rect width="452" height="54" rx="27" fill="${KHOZO}"/>
    <text x="226" y="36" text-anchor="middle" font-family="${SANS}" font-size="24" font-weight="700" fill="#fff">Free · No login · Sovereign Indian AI</text>
  </g>
  <text x="600" y="584" text-anchor="middle" font-family="${SANS}" font-size="30" font-weight="700" fill="${LIME}">khozo.org</text>
</svg>`;

const info = await sharp(Buffer.from(svg))
  .jpeg({ quality: 86, progressive: true, mozjpeg: true })
  .toFile(out);
console.log(`${path.relative(root, out)}  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`);
