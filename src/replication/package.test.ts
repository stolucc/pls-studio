import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { datasetCsv, scriptPackages } from './package';
import { crc32, makeZip } from './zip';

describe('zip writer', () => {
  it('computes CRC-32 as specified', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes archives that unzip reads back exactly (deflated and stored, UTF-8 names)', async () => {
    const big = 'x,y\n' + Array.from({ length: 2000 }, (_, i) => `${i},${i % 7}`).join('\n');
    const zip = await makeZip([{ path: 'pkg/README.md', data: '# Dé replication\n' }, { path: 'pkg/data/d.csv', data: big }, { path: 'pkg/bin.dat', data: new Uint8Array([0, 255, 1]) }]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'p.zip');
    writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
    expect(execFileSync('unzip', ['-t', file]).toString()).toContain('No errors detected');
    execFileSync('unzip', ['-q', file, '-d', dir]);
    expect(readFileSync(join(dir, 'pkg/README.md'), 'utf8')).toBe('# Dé replication\n');
    expect(readFileSync(join(dir, 'pkg/data/d.csv'), 'utf8')).toBe(big);
    expect([...readFileSync(join(dir, 'pkg/bin.dat'))]).toEqual([0, 255, 1]);
  });
});

describe('replication package parts', () => {
  it('writes the data as CSV: categories by label, missing values empty, quoting', () => {
    const csv = datasetCsv({ names: ['x', 'g, h'], cols: [Float64Array.from([1.5, NaN]), Float64Array.from([2, 1])], categories: { 'g, h': ['a "b"', 'c'] } });
    expect(csv).toBe('x,"g, h"\n1.5,c\n,"a ""b"""\n');
    expect(datasetCsv({ names: ['a', 'b'], cols: [], moments: { S: [[1, 0.5], [0.5, 2]], n: 10 } })).toBe(',a,b\na,1,0.5\nb,0.5,2\n');
  });

  it('finds the packages a script uses', () => {
    expect(scriptPackages('suppressPackageStartupMessages(library(lavaan))\nx <- semTools::compRelSEM(fit)\nif (requireNamespace("mice", quietly = TRUE)) 1\nstats::sd(1)\nlibrary(cSEM, quietly = TRUE)'))
      .toEqual(['cSEM', 'lavaan', 'mice', 'semTools']);
  });
});
