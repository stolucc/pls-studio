// Envelope encryption for datasets and TOTP secrets, and token helpers.
// AES-256-GCM everywhere; ciphertext layout: version(1) | iv(12) | tag(16) | data.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';

// Asynchronous zlib: a dataset is up to MAX_DATASET_BYTES (tens of MB), and
// compressing it is the bulk of an upload's work. The synchronous versions
// would block the event loop (every other request and socket) for seconds;
// these run on libuv's thread pool.
const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

const VERSION = 1;

export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), data]);
}

export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new Error('Unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([d.update(sealed.subarray(29)), d.final()]);
}

/**
 * Encrypt a dataset for a project: fresh per-project data key (DEK), payload
 * gzipped then sealed under the DEK, DEK sealed under the master key. The
 * project id is bound in as associated data, so ciphertexts cannot be moved
 * between projects.
 */
export async function encryptDataset(
  master: Buffer,
  projectId: string,
  json: string,
): Promise<{ ciphertext: Buffer; wrappedKey: Buffer }> {
  const compressed = await gzip(Buffer.from(json, 'utf8'));
  const dek = randomBytes(32);
  const ciphertext = seal(dek, compressed, `dataset:${projectId}`);
  const wrappedKey = seal(master, dek, `dek:${projectId}`);
  dek.fill(0);
  return { ciphertext, wrappedKey };
}

export async function decryptDataset(
  master: Buffer,
  projectId: string,
  ciphertext: Buffer,
  wrappedKey: Buffer,
): Promise<string> {
  const dek = open(master, wrappedKey, `dek:${projectId}`);
  let compressed: Buffer;
  try {
    compressed = open(dek, ciphertext, `dataset:${projectId}`);
  } finally {
    dek.fill(0);
  }
  return (await gunzip(compressed)).toString('utf8');
}

/** URL-safe random token and its SHA-256 (only the hash is stored). */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest();

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
