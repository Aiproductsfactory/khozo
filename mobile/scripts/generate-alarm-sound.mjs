// Generates the alarm sound a station alert rings with (assets/sounds/khozo_alarm.wav).
//
// Like the icons (generate-assets.mjs), the repo carries the generator, not
// only the file: the sound is a two-tone siren, the "hi-lo" police and
// ambulance pattern people already read as urgent, alternating ~960 Hz and
// ~770 Hz every half second for eight seconds. A few odd harmonics make it
// carry on a phone's small speaker, where a pure tone sounds thin. Mono 16-bit
// PCM at 22050 Hz, peaking just under full scale so it is loud without
// clipping. Android plays a channel's sound once per alert, so its length is
// how long the phone rings.
//
// Run with: node scripts/generate-alarm-sound.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds', 'khozo_alarm.wav');

const RATE = 22050;
const SECONDS = 8;
const HIGH = 960;
const LOW = 770;
const HALF_CYCLE = 0.5; // seconds on each tone
const FADE = 0.02; // seconds of fade in and out, so it does not start or end with a click
const PEAK = 0.89; // about -1 dBFS

const count = RATE * SECONDS;
const wave = new Float64Array(count);
// The phase runs on across each change of tone, so the switch makes no click.
let phase = 0;
for (let i = 0; i < count; i++) {
  const t = i / RATE;
  const freq = Math.floor(t / HALF_CYCLE) % 2 === 0 ? HIGH : LOW;
  phase += (2 * Math.PI * freq) / RATE;
  const fade = Math.min(1, t / FADE, (SECONDS - t) / FADE);
  wave[i] = (Math.sin(phase) + 0.3 * Math.sin(3 * phase) + 0.15 * Math.sin(5 * phase)) * fade;
}

let max = 0;
for (const v of wave) max = Math.max(max, Math.abs(v));
const scale = (PEAK * 32767) / max;

const data = Buffer.alloc(count * 2);
for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(wave[i] * scale), i * 2);

// A plain RIFF/WAVE header: PCM, one channel, 16 bits.
const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // bytes per second
header.writeUInt16LE(2, 32); // bytes per sample frame
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36, 'ascii');
header.writeUInt32LE(data.length, 40);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, data]));
console.log(`Wrote ${OUT} (${SECONDS} s, ${((44 + data.length) / 1024).toFixed(0)} KB)`);
