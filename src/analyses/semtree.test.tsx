// The SEM tree card: covariate scales, the tree's layout and split conditions, options from files, desktop R only
// (never webR), the request, and the view (tree, node estimates, forest importance).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, type ModelState } from '../model/project';
import { DESKTOP_ONLY, DesktopOnly } from '../rengine/bridge';
import { useCompute } from '../rengine/compute';
import * as runtime from '../rengine/runtime';
import { semTreeR, semTreeRequest, semTreeResult, type SemTreeNode } from '../rengine/semtree';
import { edgeLabel, guessType, semTreeAnalysis as t, treeLayout, type SemTreeOptions } from './semtree';
import type { AnalysisCtx } from './types';

const F = (name: string, indicators: string[]) => ({ id: name, name, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [F('A', ['a1', 'a2', 'a3'])], paths: [], moderations: [] };
const names = ['a1', 'a2', 'a3', 'g', 'z'];
const data = { names, cols: names.map((n, k) => Float64Array.from({ length: 60 }, (_, i) => (n === 'g' ? 1 + (i % 2) : n === 'z' ? i / 7 : Math.sin(i * (k + 1.3)) + (i % (k + 2))))) };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem' }, pls: null, projectName: 'p', model, ...over });
const opts: SemTreeOptions = { ...t.defaults(ctx()), covariates: [{ name: 'g', type: 'categorical' }, { name: 'z', type: 'numeric' }] };
const input = { covariates: opts.covariates, method: 'naive' as const, alpha: 0.05, maxDepth: 3, minN: 20 };
const P = [{ lhs: 'i', op: '~1', rhs: '', est: 5 }];
const nodes: SemTreeNode[] = [
  { id: 1, n: 400, terminal: false, rule: { variable: 'agegroup', relation: '>', value: ['0'] }, lr: 1253.3, df: 10, p: 1e-200, params: P },
  { id: 2, parent: 1, edge: 0, n: 200, terminal: true, params: [{ ...P[0], est: 5.02 }] },
  { id: 3, parent: 1, edge: 1, n: 200, terminal: false, rule: { variable: 'training', relation: '%in%', value: ['1'] }, lr: 37.3, df: 10, p: 0.0001, params: P },
  { id: 4, parent: 3, edge: 0, n: 100, terminal: true, params: [{ ...P[0], est: 1.94 }] },
  { id: 5, parent: 3, edge: 1, n: 100, terminal: true, params: [{ ...P[0], est: 2.0 }] },
];

describe('SEM tree helpers', () => {
  it('guesses a covariate’s scale', () => {
    expect(guessType([0, 1, 1, 0], false)).toBe('categorical');
    expect(guessType([1, 2, 3, 2], true)).toBe('categorical');
    expect(guessType([1, 2, 3, 4, 2], false)).toBe('ordered');
    expect(guessType(Array.from({ length: 30 }, (_, i) => i / 3), false)).toBe('numeric');
  });
  it('lays the leaves out in order and centres each split over its children', () => {
    const L = treeLayout(nodes);
    expect(L.leaves).toBe(3);
    expect(L.depthMax).toBe(2);
    expect([2, 4, 5].map((id) => L.x.get(id))).toEqual([0, 1, 2]);
    expect(L.x.get(3)).toBe(1.5);
    expect(L.x.get(1)).toBe(0.75);
  });
  it('writes each side of a split as its condition (the left child is the rule false), with category labels', () => {
    expect(edgeLabel(nodes[0].rule!, 0)).toBe('agegroup ≤ 0');
    expect(edgeLabel(nodes[0].rule!, 1)).toBe('agegroup > 0');
    expect(edgeLabel(nodes[2].rule!, 1, ['yes', 'no'])).toBe('training ∈ {yes}');
    expect(edgeLabel(nodes[2].rule!, 0)).toBe('training ∉ {1}');
  });
});

describe('SEM tree card', () => {
  beforeEach(() => useCompute.setState({ backend: 'browser' } as never));
  it('is desktop-only, installed by the helper; the bridge never starts R in the browser', async () => {
    expect(DESKTOP_ONLY.has('semtree')).toBe(true);
    expect(readFileSync(join(__dirname, '..', '..', 'helper', 'r', 'packages.txt'), 'utf8').split('\n')).toContain('semtree');
    const spy = vi.spyOn(runtime, 'withR');
    await expect(semTreeR({ data, spec: toSpec(model), missing: 'casewise', estimator: 'ML' }, input)).rejects.toThrow(DesktopOnly);
    expect(spy).not.toHaveBeenCalled();
  });
  it('says what it needs, and options from a file are bounded', () => {
    expect(t.blocked(opts, ctx())).toMatch(/desktop R/);
    useCompute.setState({ backend: 'helper' } as never);
    expect(t.blocked(opts, ctx())).toBeNull();
    expect(t.blocked({ ...opts, covariates: [] }, ctx())).toMatch(/Choose the covariates/);
    expect(t.blocked({ ...opts, covariates: [{ name: 'a1', type: 'numeric' }] }, ctx())).toMatch(/a1 is a variable of the model/);
    expect(t.blocked({ ...opts, covariates: [{ name: 'q', type: 'numeric' }] }, ctx())).toMatch(/Not in the data: q/);
    expect(t.parseOptions({ covariates: [{ name: 'g', type: 'x' }, { name: 'g', type: 'ordered' }, 3, { name: '' }], maxDepth: 99, trees: '20', forest: 'yes' }))
      .toMatchObject({ covariates: [{ name: 'g', type: 'numeric' }], maxDepth: 10, trees: 20, forest: false });
    expect(t.fingerprint(opts, ctx())).not.toBe(t.fingerprint({ ...opts, covariates: [opts.covariates[0]] }, ctx()));
  });
  it('sends the covariates with their scales and the model’s columns', () => {
    const r = semTreeRequest({ data, spec: toSpec(model), missing: 'casewise', estimator: 'ML' }, { ...input, forest: { trees: 10, seed: 3 } });
    expect(r.covariates.names).toEqual(['g', 'z']);
    expect(r.covariates.types).toEqual(['categorical', 'numeric']);
    expect(r.tree).toEqual({ method: 'naive', alpha: 0.05, maxDepth: 3, minN: 20, forest: { trees: 10, seed: 3 } });
    expect(r.data.names).toEqual(['a1', 'a2', 'a3']);
    expect(() => semTreeRequest({ data, spec: toSpec(model), missing: 'casewise', estimator: 'ML' }, { ...input, covariates: [{ name: 'q', type: 'numeric' }] })).toThrow(/Not in the data/);
  });
  it('draws the tree, the chosen node’s estimates, the leaves side by side and the forest’s importance', () => {
    const r = semTreeResult({ nodes, n: 400, method: 'naive', alpha: 0.05, maxDepth: 3, minN: 20, covariates: [], forest: { variables: ['agegroup', 'noise'], importance: [4437.8, null], trees: 10, seed: 1 }, warnings: [], engine: { package: 'semtree', version: '0.9.23' } });
    const h = renderToStaticMarkup(<t.View result={r} options={opts} current />);
    expect(h).toContain('aria-label="SEM tree"');
    expect(h).toContain('agegroup ≤ 0');
    expect(h).toContain('Node 1: N = 400 (all cases)');
    expect(h).toContain('Node 5 (N = 100)');
    expect(h).toContain('Node 4: agegroup &gt; 0 and training ∉ {1}');
    expect(h).toContain('aria-label="Variable importance"');
    expect(h).toContain('not used');
  });
});
