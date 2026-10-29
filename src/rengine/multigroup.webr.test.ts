// Multiple groups and measurement invariance through lavaan in webR, against
// desktop lavaan 0.6-16 (scripts/validation/multigroup.R): Holzinger &
// Swineford by school. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { InvarianceLevel, ModelSpec } from '../engine/types';
import { cbScriptLavaan, estimateCbLavaan, invarianceR } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'multigroup');
const data = parseCsv(readFileSync(join(DIR, 'hs_school.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(DIR, 'hs_school.json'), 'utf8'));
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const spec = (invariance: InvarianceLevel, free: NonNullable<ModelSpec['multigroup']>['free'] = []): ModelSpec => ({
  constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])],
  paths: [], multigroup: { column: 'school', invariance, free },
});

describe('multiple groups (lavaan)', () => {
  it.each(['configural', 'metric', 'scalar', 'strict'] as const)('%s model matches lavaan', async (level) => {
    const r = await estimateCbLavaan(data, spec(level), 'casewise', 'ML');
    expect(r.fit.chisq).toBeCloseTo(ref.levels[level].chisq, 3);
    expect(r.fit.df).toBe(ref.levels[level].df);
    expect(r.groups!.labels).toEqual(['1', '2']);
    expect(r.groups!.results).toHaveLength(2);
    if (level === 'configural') {
      const g2 = r.groups!.results[1];
      expect(g2.estimates.find((e) => e.lhs === 'visual' && e.op === '=~' && e.rhs === 'x2')!.est).toBeCloseTo(ref.loadingGroup2Configural, 5);
      expect(r.modindices![0]).toMatchObject({ lhs: ref.topModindex.lhs, op: ref.topModindex.op, rhs: ref.topModindex.rhs, mi: expect.closeTo(ref.topModindex.mi, 3) });
    }
    if (level === 'scalar') {
      // Latent means are free in the second group.
      const means = r.groups!.results[1].estimates.filter((e) => e.kind === 'mean');
      for (const m of ref.latentMeansGroup2) expect(means.find((e) => e.lhs === m.lhs)!.est).toBeCloseTo(m.est, 5);
      const top = [...r.groups!.score].sort((a, b) => b.x2 - a.x2)[0];
      expect(top.param.replace(/\s+/g, ' ').trim()).toBe(ref.topScore.param.replace(/\s+/g, ' ').trim());
      expect(top.x2).toBeCloseTo(ref.topScore.x2, 3);
    }
  }, 600_000);

  it('partial invariance frees the chosen intercepts', async () => {
    const r = await estimateCbLavaan(data, spec('scalar', [{ kind: 'intercept', indicator: 'x3' }, { kind: 'intercept', indicator: 'x7' }]), 'casewise', 'ML');
    expect(r.fit.chisq).toBeCloseTo(ref.partial.chisq, 3);
    expect(r.fit.df).toBe(ref.partial.df);
    const script = await cbScriptLavaan(data, spec('scalar', [{ kind: 'intercept', indicator: 'x3' }]), 'casewise', 'ML');
    expect(script).toContain('group = "school", group.equal = c("loadings", "intercepts"), group.partial = c("x3~1")');
  }, 600_000);

  it('the invariance sequence matches lavTestLRT', async () => {
    const r = await invarianceR(data, spec('configural'), 'casewise', 'ML');
    expect(r.levels.map((l) => l.level)).toEqual(['configural', 'metric', 'scalar', 'strict']);
    r.levels.slice(1).forEach((l, i) => {
      expect(l.chisqDiff!).toBeCloseTo(ref.lrt.chisqDiff[i], 3);
      expect(l.dfDiff).toBe(ref.lrt.dfDiff[i]);
      expect(l.p!).toBeCloseTo(ref.lrt.p[i], 6);
    });
    expect(r.levels[2].cfiChange!).toBeCloseTo(ref.levels.scalar.cfi - ref.levels.metric.cfi, 6);
  }, 600_000);
});

it('a text grouping column: the same model, groups named by their text', async () => {
  const csv = readFileSync(join(DIR, 'hs_school.csv'), 'utf8').replace(/,1$/gm, ',Pasteur').replace(/,2$/gm, ',"Grant-White"');
  const text = parseCsv(csv).dataset;
  expect(text.categories?.school).toEqual(['Grant-White', 'Pasteur']);
  const spec: ModelSpec = {
    constructs: [['visual', 'x1', 'x2', 'x3'], ['textual', 'x4', 'x5', 'x6'], ['speed', 'x7', 'x8', 'x9']].map(([name, ...indicators]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators })),
    paths: [], multigroup: { column: 'school', invariance: 'metric', free: [] },
  };
  const [byText, byCode] = await Promise.all([estimateCbLavaan(text, spec, 'casewise', 'ML'), estimateCbLavaan(data, spec, 'casewise', 'ML')]);
  expect(byText.fit.chisq).toBeCloseTo(byCode.fit.chisq, 8);
  expect([...byText.groups!.labels].sort()).toEqual(['Grant-White', 'Pasteur']);
  // Pasteur is 1 in the coded file and 2 in the text file: same group, same estimates.
  const at = (r: typeof byText, label: string) => r.groups!.results[r.groups!.labels.indexOf(label)];
  const x2 = (r: typeof byText, label: string) => at(r, label).estimates.find((e) => e.op === '=~' && e.rhs === 'x2')!.est;
  expect(x2(byText, 'Pasteur')).toBeCloseTo(x2(byCode, '1'), 8);
}, 600_000);
