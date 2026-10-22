// SHA-256 of a file of any size, read a piece at a time.
//
// The browser's own digest (crypto.subtle) needs the whole file in memory at
// once, and CCTV exports are often several gigabytes. This reads the file in
// pieces, so it works on a 4 GB file on an ordinary office computer. The
// result is the file's fingerprint: the audit log keeps it, so the footage the
// police hold can later be shown to be the very file that was searched.
//
// Pure, so scripts/video-faces-smoke.mjs checks it against Node's own SHA-256.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** An incremental SHA-256: `update(bytes)` as often as needed, then `hex()`. */
export function createSha256() {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const block = new Uint8Array(64);
  let blockLen = 0;
  let total = 0;
  let done = false;

  function compress(bytes, offset) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
    let e = h[4]; let f = h[5]; let g = h[6]; let k = h[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }

  return {
    update(input) {
      if (done) throw new Error('SHA-256 already finished');
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      total += bytes.length;
      let i = 0;
      if (blockLen) {
        const take = Math.min(64 - blockLen, bytes.length);
        block.set(bytes.subarray(0, take), blockLen);
        blockLen += take;
        i = take;
        if (blockLen === 64) {
          compress(block, 0);
          blockLen = 0;
        }
      }
      for (; i + 64 <= bytes.length; i += 64) compress(bytes, i);
      if (i < bytes.length) {
        block.set(bytes.subarray(i), 0);
        blockLen = bytes.length - i;
      }
      return this;
    },
    hex() {
      if (!done) {
        done = true;
        const bits = total * 8;
        block[blockLen] = 0x80;
        block.fill(0, blockLen + 1);
        if (blockLen + 1 > 56) {
          compress(block, 0);
          block.fill(0);
        }
        // The length in bits, big-endian, in the last eight bytes.
        const high = Math.floor(bits / 0x100000000);
        const low = bits >>> 0;
        block[56] = high >>> 24; block[57] = high >>> 16; block[58] = high >>> 8; block[59] = high;
        block[60] = low >>> 24; block[61] = low >>> 16; block[62] = low >>> 8; block[63] = low;
        compress(block, 0);
      }
      return Array.from(h, (v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
    },
  };
}

/**
 * The SHA-256 of a File or Blob, as hex, read in 4 MB pieces. `onProgress`
 * hears the share done, 0 to 1; `signal` stops it.
 */
export async function fileSha256(file, { onProgress, signal, chunk = 4 * 1024 * 1024 } = {}) {
  const hash = createSha256();
  const size = file.size || 0;
  for (let offset = 0; offset < size; offset += chunk) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    // eslint-disable-next-line no-await-in-loop
    const piece = new Uint8Array(await file.slice(offset, Math.min(size, offset + chunk)).arrayBuffer());
    hash.update(piece);
    onProgress?.(Math.min(1, (offset + piece.length) / size));
  }
  return hash.hex();
}
