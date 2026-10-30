// Analysis results in project files: JSON (typed arrays tagged so they come
// back as typed arrays) → gzip → base64. Results come back from untrusted
// files, so sizes are capped on both sides of the compression.

/** Largest packed result kept in a project (characters of base64). */
export const MAX_PACKED = 8_000_000;
/** Largest unpacked result accepted (bytes of JSON), against decompression bombs. */
export const MAX_UNPACKED = 64_000_000;

const TYPED = '__f64';

function replacer(_k: string, v: unknown) {
  if (v instanceof Float64Array || v instanceof Float32Array || v instanceof Int32Array) {
    return { [TYPED]: Array.from(v, (x) => (Number.isFinite(x) ? x : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf')) };
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return { [TYPED + 'n']: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
  return v;
}
const special = (x: unknown) => (x === 'NaN' ? NaN : x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : typeof x === 'number' ? x : NaN);
function reviver(_k: string, v: unknown) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === TYPED && Array.isArray(o[TYPED])) return Float64Array.from(o[TYPED] as unknown[], special);
    if (keys.length === 1 && keys[0] === TYPED + 'n') return special(o[TYPED + 'n']);
  }
  return v;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel(); throw new Error('The stored result is too large.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Pack a result for a project file; null when it is too large to keep. */
export async function packResult(value: unknown): Promise<string | null> {
  const json = new TextEncoder().encode(JSON.stringify(value, replacer));
  if (json.length > MAX_UNPACKED) return null;
  const gz = await readAll(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')), MAX_UNPACKED);
  const text = toBase64(gz);
  return text.length > MAX_PACKED ? null : text;
}

export async function unpackResult(text: string, maxBytes = MAX_UNPACKED): Promise<unknown> {
  if (typeof text !== 'string' || text.length > MAX_PACKED || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid stored result.');
  const raw = await readAll(new Blob([fromBase64(text)]).stream().pipeThrough(new DecompressionStream('gzip')), maxBytes);
  return JSON.parse(new TextDecoder().decode(raw), reviver);
}

// ---------- fingerprints of an analysis' inputs ----------

const colCache = new WeakMap<Float64Array, string>();

/** 53-bit string hash (cyrb53). */
function hashString(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function hashColumn(col: Float64Array): string {
  const hit = colCache.get(col);
  if (hit) return hit;
  // The column's bytes, two 32-bit words per value (NaN is one bit pattern in a Float64Array from the app).
  const words = new Uint32Array(col.buffer, col.byteOffset, col.length * 2);
  let h1 = 0x9e3779b9 ^ col.length, h2 = 0x85ebca6b;
  for (let i = 0; i < words.length; i++) {
    h1 = Math.imul(h1 ^ words[i], 2654435761);
    h2 = Math.imul(h2 ^ words[i], 1597334677);
    h1 = (h1 << 13) | (h1 >>> 19);
  }
  const out = `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
  colCache.set(col, out);
  return out;
}

/**
 * A short fingerprint of an analysis' inputs: strings, numbers and data
 * columns. Columns are hashed once each (they are replaced, never mutated).
 */
export function fingerprint(parts: (string | number | null | Float64Array)[]): string {
  return hashString(parts.map((p) => (p instanceof Float64Array ? `#${hashColumn(p)}` : JSON.stringify(p))).join('|'));
}
