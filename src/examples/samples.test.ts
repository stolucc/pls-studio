// The open sample projects: the built-in engine against plain cSEM calls (scripts/validation/open_samples.R), and their
// data contain items only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { estimatePls } from '../engine/pls';
import { toSpec } from '../model/project';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

const ROOT = join(__dirname, '..', '..');
const ref = JSON.parse(readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'samples', 'reference.json'), 'utf8'));
const CASES = [['sample-tam', 'tam', {}], ['sample-utaut', 'utaut', {}], ['sample-retention', 'retention', { Workload: 'WL', Fulfilment: 'JS', Leaving: 'QUIT' }]] as const;

describe.each(CASES)('%s', (id, key, rename) => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  const text = readFileSync(join(ROOT, 'public', ex.data.file!), 'utf8');
  const data = parseCsv(text).dataset;
  const r = estimatePls(data, toSpec(exampleModel(ex)), { missing: 'mean', maxIter: 300, tolerance: 1e-7 });
  const name = (c: string) => (rename as Record<string, string>)[c] ?? c;
  it('reproduces cSEM', () => {
    expect(r.n).toBe(ref[key].n);
    r.constructs.forEach((to, j) => r.constructs.forEach((from, i) => {
      if (r.hasPath[i][j]) expect(r.pathCoef[i][j], `${from} → ${to}`).toBeCloseTo(ref[key].paths[name(to)][name(from)], 3);
    }));
    r.constructs.forEach((c, j) => { if (r.rSquared[j] !== null) expect(r.rSquared[j], `R² ${c}`).toBeCloseTo(ref[key].r2[name(c)], 3); });
  });
  it('states the numbers it gets', () => {
    const paths = ref[key].paths as Record<string, Record<string, number>>;
    const largest = Math.max(...Object.values(paths).flatMap((row) => Object.values(row).map((v) => Math.abs(v ?? 0))));
    expect(ex.shows).toContain(String(Number(largest.toFixed(3))));
  });
  it('ships numbers only: no names, dates or free text', () => {
    const [header, ...rows] = text.trim().split('\n');
    expect(header).toMatch(/^[A-Z0-9,]+$/);
    for (const row of rows) expect(row).toMatch(/^[\d.,]*$/);
  });
});

describe('sample-bifactor', () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'sample-bifactor')!;
  const bf = JSON.parse(readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'samples', 'bifactor_cpb.json'), 'utf8'));
  it('is the study’s model: a general factor of all items, four specific factors, all uncorrelated', () => {
    const spec = toSpec(exampleModel(ex));
    expect(spec.constructs.map((k) => [k.name, k.indicators.length])).toEqual([['GEN', 14], ['IS', 3], ['ISH', 4], ['RB', 4], ['PI', 3]]);
    expect(bf.proper).toBe(true);
    expect(bf.n).toBe(429);
    expect(ex.tags).toContain('Bifactor');
  });
  it('states what lavaan gives', () => {
    for (const v of [bf.fit.chisq, bf.fit['chisq.scaled'], bf.indices.ECV, bf.indices.omega, bf.indices.omegaH, bf.fit['cfi.robust'], bf.fit.srmr]) expect(ex.shows).toContain(v.toFixed(3));
    const loading = (rhs: string) => bf.estimates.find((e: { lhs: string; rhs: string }) => e.lhs !== 'GEN' && e.rhs === rhs).std;
    expect(ex.shows).toContain(loading('PI3').toFixed(2));
    expect(ex.shows).toContain(loading('PI1').toFixed(2));
  });
  it('ships the items only', () => {
    const text = readFileSync(join(ROOT, 'public', ex.data.file!), 'utf8');
    expect(text.split('\n')[0]).toBe('IS1,IS2,IS3,ISH1,ISH2,ISH3,ISH4,RB1,RB2,RB3,RB4,PI1,PI3,PI5');
    expect(text.trim().split('\n').slice(1).every((r) => /^[\d.,]*$/.test(r))).toBe(true);
  });
});
