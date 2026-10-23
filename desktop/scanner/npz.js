// Reading NumPy .npz files: a zip of .npy arrays, as Aarakshak keeps the
// adapter it applies after ResNet100 (a 512 x 512 weight and a 512 bias).
// Enough of both formats for that: little-endian float32 arrays in C order,
// zip entries stored or deflated, with or without zip64 sizes (NumPy writes
// them).
import fs from 'node:fs';
import zlib from 'node:zlib';

/** One .npy array: `{ shape, data }`, `data` a Float32Array. */
export function readNpy(buf) {
  if (buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY') throw new Error('Not a NumPy array');
  const major = buf[6];
  const start = major === 1 ? 10 : 12;
  const headerLength = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const header = buf.toString('latin1', start, start + headerLength);
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  if (descr !== '<f4') throw new Error(`Only little-endian float32 arrays are read, not ${descr}`);
  if (/'fortran_order':\s*True/.test(header)) throw new Error('Fortran-ordered arrays are not read');
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const count = shape.reduce((a, b) => a * b, 1);
  const offset = start + headerLength;
  if (buf.length < offset + count * 4) throw new Error('The array is shorter than its header says');
  const data = new Float32Array(count);
  for (let i = 0; i < count; i += 1) data[i] = buf.readFloatLE(offset + i * 4);
  return { shape, data };
}

/** Every array in an .npz file, by name without ".npy". */
export function readNpz(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`Not a zip file: ${file}`);
  let entries = buf.readUInt16LE(eocd + 10);
  let directory = buf.readUInt32LE(eocd + 16);
  if ((entries === 0xffff || directory === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const zip64 = Number(buf.readBigUInt64LE(eocd - 12));
    entries = Number(buf.readBigUInt64LE(zip64 + 32));
    directory = Number(buf.readBigUInt64LE(zip64 + 48));
  }
  const arrays = {};
  let p = directory;
  for (let n = 0; n < entries; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`Damaged zip directory in ${file}`);
    const method = buf.readUInt16LE(p + 10);
    let packed = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    // Zip64 keeps the real sizes and offset in an extra field, in this order,
    // for each value the directory left at 0xffffffff.
    for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength;) {
      const id = buf.readUInt16LE(e);
      const length = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (packed === 0xffffffff) { packed = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (local === 0xffffffff) { local = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + length;
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression ${method} in ${file}`);
    if (data.length !== size) throw new Error(`${name} in ${file} is not the size the zip says`);
    arrays[name.replace(/\.npy$/, '')] = readNpy(Buffer.from(data));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return arrays;
}
