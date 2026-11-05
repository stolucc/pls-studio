// The free-format converter (convert.ts) against scripts/validation/mplus_data.py, whose port it is: small inputs
// with the notation it has to read (the expected CSVs are what the Python script writes for them), and every Mplus
// example in the test cache (npm run data:fetch keeps the downloaded .inp and .dat files in .cache/mplus/src),
// converted by both and compared byte for byte.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandNames, freeFormatCsv, latin1, mplusCsv, mplusInput } from './convert';

const SYN1_INP = 'TITLE:\tsynthetic: a test\r\n  of notation\r\nDATA:\tFILE IS "syn1.dat";  ! a comment; FILE = wrong.dat;\r\n'
  + 'VARIABLE:\tNAMES ARE y1-y3 A31-a32\r\n  y1a-y1c X;\r\n\tMISSING = ALL (999, -1.5) u (9);\r\nMODEL:\tf BY y1-y3;\r\n';

describe('the free-format converter (a port of mplus_data.py)', () => {
  it('expands Mplus list notation as the Python script does, in lower case', () => {
    // (A31-a32: the prefixes differ in case, so the token stays; q5-q3 runs backwards and gives nothing)
    expect(expandNames('y1-y3 A31-a32 y1a-y1c X q5-q3 b2-c4')).toEqual(['y1', 'y2', 'y3', 'a31-a32', 'y1a', 'y1b', 'y1c', 'x', 'b2-c4']);
    expect(expandNames('a31-a34')).toEqual(['a31', 'a32', 'a33', 'a34']);
  });

  it('reads the file, the names and the missing-value codes from the input, comments and quotes removed', () => {
    expect(mplusInput(SYN1_INP)).toEqual({ file: 'syn1.dat', names: ['y1', 'y2', 'y3', 'a31-a32', 'y1a', 'y1b', 'y1c', 'x'], missing: [999, -1.5, 9] });
    expect(mplusInput('data: file = a.dat;\nvariable: names = a b;\n')).toEqual({ file: 'a.dat', names: ['a', 'b'], missing: [] });
    // A Monte Carlo study reads no data.
    expect(mplusInput('MONTECARLO: NAMES = y1-y4; NOBSERVATIONS = 500;\nMODEL: f BY y1-y4;')).toBeNull();
  });

  it('writes what the Python script writes: records across line breaks, *, . and the codes as empty cells, commas as separators', () => {
    const r = mplusCsv('syn1', SYN1_INP, (f) => (f === 'syn1.dat' ? '1 2 3 4 5\n6 7 8\n999 10 * . -1.5 1,2\n-1.50\n' : null))!;
    expect(r.csv).toBe('y1,y2,y3,a31-a32,y1a,y1b,y1c,x\n1,2,3,4,5,6,7,8\n,10,,,,1,2,\n');
    expect([r.rows, r.file]).toEqual([2, 'syn1.dat']);
  });

  it('drops trailing columns the input does not name when every line has them (the generating class)', () => {
    expect(freeFormatCsv('1 0 . 7\n0 1 1 8\n\n  * 0 1 9\n', ['u1', 'u2', 'u3']).csv).toBe('u1,u2,u3\n1,0,\n0,1,1\n,0,1\n');
  });

  it('refuses values that do not divide into records', () => {
    expect(() => freeFormatCsv('1 2 3\n4 5\n', ['a', 'b'], [], 'syn3')).toThrow('syn3: 5 values do not divide into records of 2');
  });

  it('decodes bytes as ISO-8859-1, one character per byte', () => {
    expect(latin1(Uint8Array.from([0x31, 0x85, 0xe9, 0x32]))).toBe('1\u0085é2');
    // (\x85 is whitespace to Python, so it separates values as it does there)
    expect(freeFormatCsv('1\u00852\n', ['a', 'b']).csv).toBe('a,b\n1,2\n');
  });
});

const SRC = join(__dirname, '..', '..', '..', '.cache', 'mplus', 'src');
const PY = join(__dirname, '..', '..', '..', 'scripts', 'validation', 'mplus_data.py');
const python = (() => { try { execFileSync('python3', ['--version']); return true; } catch { return false; } })();
const inputs = existsSync(SRC) ? readdirSync(SRC).filter((f) => f.endsWith('.inp')).map((f) => f.slice(0, -4)).sort() : [];

describe.skipIf(!python || !inputs.length)('every cached Mplus example', () => {
  it('converts to the same bytes as mplus_data.py', () => {
    const out = mkdtempSync(join(tmpdir(), 'mplus-py-'));
    try {
      // The Python script's convert(), loaded from its file (python3 -I: nothing else on the path).
      execFileSync('python3', ['-I', '-c', [
        'import importlib.util, sys',
        `spec = importlib.util.spec_from_file_location('md', sys.argv[1]); md = importlib.util.module_from_spec(spec); spec.loader.exec_module(md)`,
        'for ex in sys.argv[4:]:',
        '    try: md.convert(sys.argv[2], ex, sys.argv[3])',
        '    except ValueError: pass',
      ].join('\n'), PY, SRC, out, ...inputs]);
      let compared = 0;
      for (const ex of inputs) {
        const read = (f: string) => (existsSync(join(SRC, f)) ? latin1(readFileSync(join(SRC, f))) : null);
        let mine: string | null = null;
        try { mine = mplusCsv(ex, read(`${ex}.inp`)!, read)?.csv ?? null; } catch { /* (the script skips it too) */ }
        const theirs = existsSync(join(out, `${ex}.csv`)) ? readFileSync(join(out, `${ex}.csv`), 'utf8') : null;
        expect(mine, ex).toBe(theirs);
        if (theirs !== null) compared++;
      }
      expect(compared).toBeGreaterThan(Math.min(100, inputs.length / 2));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
