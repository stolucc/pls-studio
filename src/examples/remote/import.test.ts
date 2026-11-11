import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { downloadLinks, importedDataset } from './load';
import { zipEntries, zipEntry } from './unzip';

const enc = (s: string) => new TextEncoder().encode(s);
const INP =
  'TITLE: a test\nDATA: FILE IS ex7.5.dat;\nVARIABLE: NAMES ARE u1-u3 x;\n  MISSING = ALL (999);\nMODEL: %OVERALL%\n';
const DAT = '1 0 1  0.5\n0 999 1 -1.25\n1 1 0 2\n';

/** A zip archive of `files` (deflated, or stored when `store`), as statmodel.com's chapter archives are laid out. */
function zip(files: Record<string, string>, store = false): Uint8Array {
  const parts: Buffer[] = [],
    central: Buffer[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'latin1'),
      data = store ? raw : deflateRawSync(raw),
      n = Buffer.from(name, 'latin1');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    parts.push(local, n, data);
    central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

describe('importing example data a person downloaded themselves', () => {
  const r = { kind: 'mplus' as const, example: '7.5' };

  it('reads the input and data files, converted as a download is (names, missing values)', async () => {
    const { data, fileName } = await importedDataset(r, [
      { name: 'ex7.5.inp', bytes: enc(INP) },
      { name: 'EX7.5.DAT', bytes: enc(DAT) },
    ]);
    expect(fileName).toBe('ex7.5.dat');
    expect(data.names).toEqual(['u1', 'u2', 'u3', 'x']);
    expect(Array.from(data.cols[1])).toEqual([0, NaN, 1]);
    expect(Array.from(data.cols[3])).toEqual([0.5, -1.25, 2]);
  });

  it('finds them inside the chapter’s zip archive (deflated or stored), among other examples’ files', async () => {
    for (const store of [false, true]) {
      const z = zip(
        {
          'chapter7/ex7.4.inp': 'other',
          'chapter7/ex7.5.inp': INP,
          'chapter7/ex7.5.dat': DAT,
          'chapter7/ex7.5.out': 'output',
        },
        store,
      );
      expect([...zipEntries(z).keys()]).toContain('chapter7/ex7.5.dat');
      expect(
        new TextDecoder().decode(await zipEntry(z, zipEntries(z).get('chapter7/ex7.5.inp')!)),
      ).toBe(INP);
      const { data } = await importedDataset(r, [{ name: 'chapter7.zip', bytes: z }]);
      expect(data.names).toEqual(['u1', 'u2', 'u3', 'x']);
      expect(data.cols[0].length).toBe(3);
    }
  });

  it('says which file is missing', async () => {
    await expect(importedDataset(r, [{ name: 'ex7.5.dat', bytes: enc(DAT) }])).rejects.toThrow(
      /ex7\.5\.inp too/,
    );
    await expect(importedDataset(r, [{ name: 'ex7.5.inp', bytes: enc(INP) }])).rejects.toThrow(
      /ex7\.5\.dat too/,
    );
    await expect(
      importedDataset(r, [{ name: 'notes.zip', bytes: enc('not a zip') }]),
    ).rejects.toThrow(/not a zip/);
  });

  it('links to the example’s page and the chapter’s archive', () => {
    expect(downloadLinks(r).map((l) => l.url)).toEqual([
      'https://www.statmodel.com/usersguide/chap7/ex7.5.html',
      'https://www.statmodel.com/usersguide/chap7/chapter7.zip',
    ]);
  });
});
