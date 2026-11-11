// A small zip reader for files a person downloaded themselves, e.g. statmodel.com's chapter archives
// (usersguide/chapN/chapterN.zip): the central directory, then each wanted entry stored or deflated, inflated with the
// platform's DecompressionStream (browsers and Node). Nothing else of the zip format is needed for these archives.

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** The archive's entries by name (folders left out): their compression method and where their data start. */
export function zipEntries(
  zip: Uint8Array,
): Map<string, { method: number; offset: number; size: number; usize: number }> {
  // End of central directory: the last "PK\x05\x06" (a comment of at most 65,535 bytes may follow it).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a zip archive.');
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const out = new Map<string, { method: number; offset: number; size: number; usize: number }>();
  const dec = new TextDecoder('latin1');
  for (let k = 0; k < count; k++) {
    if (u32(zip, p) !== 0x02014b50) throw new Error('The zip archive is damaged.');
    const method = u16(zip, p + 10),
      size = u32(zip, p + 20),
      usize = u32(zip, p + 24);
    const nlen = u16(zip, p + 28),
      xlen = u16(zip, p + 30),
      clen = u16(zip, p + 32),
      local = u32(zip, p + 42);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nlen));
    // The data follow the local header, whose own name and extra fields may differ in length from the central ones.
    const offset = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    if (!name.endsWith('/')) out.set(name, { method, offset, size, usize });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** One entry's contents. */
export async function zipEntry(
  zip: Uint8Array,
  e: { method: number; offset: number; size: number; usize: number },
): Promise<Uint8Array> {
  const raw = zip.subarray(e.offset, e.offset + e.size);
  if (e.method === 0) return raw.slice();
  if (e.method !== 8)
    throw new Error(
      'The zip archive uses a compression method that is not supported here (only stored and deflate).',
    );
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== e.usize) throw new Error('The zip archive is damaged.');
  return out;
}
