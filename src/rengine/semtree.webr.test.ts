// SEM trees in desktop R equal semtree called directly (scripts/validation/semtree.R): the lgcm growth curve split on
// agegroup, training and noise, node by node, and a seeded forest's variable importance. semtree runs on OpenMx,
// desktop R only: these run with PS_NATIVE_R (the helper's R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { toSpec } from '../model/project';
import { parseLavaanSyntax } from '../model/syntax';
import { semTreeR, semTreeScriptR, type SemTreeInput, type SemTreeModel } from './semtree';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ROOT = join(__dirname, '..', '..');
const ref = JSON.parse(
  readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'semtree', 'reference.json'), 'utf8'),
);
const data = parseCsv(
  readFileSync(join(ROOT, 'public', 'examples', 'semtree', 'lgcm.csv'), 'utf8'),
).dataset;
// The example’s growth curve as the canvas holds it (the semtree-lgcm example’s syntax).
const LGCM =
  'i =~ 1*o1 + 1*o2 + 1*o3 + 1*o4 + 1*o5\ns =~ 0*o1 + 1*o2 + 2*o3 + 3*o4 + 4*o5\ni ~ 1\ns ~ 1\no2 ~ 0*1\no3 ~ 0*1\no4 ~ 0*1\no5 ~ 0*1\no1 ~~ e*o1\no2 ~~ e*o2\no3 ~~ e*o3\no4 ~~ e*o4\no5 ~~ e*o5\ni ~~ s';
const model: SemTreeModel = {
  data,
  spec: toSpec(parseLavaanSyntax(LGCM).model),
  missing: 'casewise',
  estimator: 'ML',
};
const covariates: SemTreeInput['covariates'] = [
  { name: 'agegroup', type: 'ordered' },
  { name: 'training', type: 'categorical' },
  { name: 'noise', type: 'numeric' },
];
const input: SemTreeInput = { covariates, method: 'naive', alpha: 0.05, maxDepth: 3, minN: 20 };
const key = (p: { lhs: string; op: string; rhs: string }) => `${p.lhs} ${p.op} ${p.rhs}`;

describe('SEM trees (semtree, desktop R)', () => {
  it('grows semtree’s tree for the lgcm growth curve, node by node', async () => {
    const r = await semTreeR(model, input);
    expect(r.nodes.map((n) => [n.id, n.n, n.terminal])).toEqual(
      ref.nodes.map((n: { id: number; n: number; leaf: boolean }) => [n.id, n.n, n.leaf]),
    );
    r.nodes.forEach((n, k) => {
      const x = ref.nodes[k];
      if (!n.terminal) {
        expect(n.rule!.variable).toBe(x.rule);
        expect(n.lr).toBeCloseTo(x.lr, 4);
      }
      for (const [name, v] of Object.entries(x.est as Record<string, number>)) {
        const p = n.params.find(
          (q) => key(q) === name.trim() || `${key(q)} ` === name || key(q) === name,
        );
        expect(p, `node ${n.id}: ${name}`).toBeTruthy();
        expect(p!.est, `node ${n.id}: ${name}`).toBeCloseTo(v, 5);
      }
    });
    // The first split: agegroup > 0 (the right child), as semtree prints it.
    expect(r.nodes[0].rule).toMatchObject({ variable: 'agegroup', relation: '>', value: ['0'] });
    expect(r.nodes.find((n) => n.id === 2)).toMatchObject({ parent: 1, edge: 0 });
    expect(r.forest).toBeUndefined();
    const script = await semTreeScriptR(model, input);
    expect(script).toContain(
      'tree <- semtree(model = fit, data = data, predictors = c("agegroup", "training", "noise")',
    );
    expect(script).toContain('data$agegroup <- ordered(data$agegroup)');
  }, 600_000);

  it('a seeded SEM forest’s permutation importance equals the direct run', async () => {
    const r = await semTreeR(model, { ...input, forest: { trees: 10, seed: 1 } });
    expect(r.forest!.trees).toBe(10);
    expect(r.forest!.variables).toEqual(['agegroup', 'training', 'noise']);
    // (the same draws; the refits agree to about 1e-8 relative)
    expect(r.forest!.importance[0]! / ref.importance.agegroup).toBeCloseTo(1, 7);
    expect(r.forest!.importance[1]! / ref.importance.training).toBeCloseTo(1, 7);
    expect(r.forest!.importance[2]).toBeNull();
  }, 600_000);

  it('refuses a covariate that is a model variable', async () => {
    await expect(
      semTreeR(model, { ...input, covariates: [{ name: 'o1', type: 'numeric' }] }),
    ).rejects.toThrow(/also a variable of the model/);
  }, 600_000);
});
