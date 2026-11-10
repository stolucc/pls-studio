import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { ols } from '../engine/nonlinear';
import { estimatePls } from '../engine/pls';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { analyseNonlinear, nonlinearAnalysis } from './nonlinear';
import { analysisType } from './registry';
import type { AnalysisCtx } from './types';

const data = parseCsv(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const pls = estimatePls(data, { constructs: [{ name: 'Image', mode: 'A', indicators: items('IMAG', 5) }, { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) }, { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) }],
  paths: [{ from: 'Image', to: 'Satisfaction' }, { from: 'Satisfaction', to: 'Loyalty' }, { from: 'Image', to: 'Loyalty' }] });
const K = (id: string) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: [], x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('Image'), K('Satisfaction'), K('Loyalty')], paths: [{ id: 'p', from: 'Image', to: 'Satisfaction' }], moderations: [] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'pls' }, pls, projectName: 'p', model, ...over });

describe('nonlinear paths card', () => {
  it('is registered in the PLS-SEM group and needs current PLS results without terms', () => {
    expect(analysisType('nonlinear')).toBe(nonlinearAnalysis);
    expect(nonlinearAnalysis.blocked({ shapes: {} }, ctx())).toBeNull();
    expect(nonlinearAnalysis.blocked({ shapes: {} }, ctx({ pls: null }))).toMatch(/Calculate/);
    expect(nonlinearAnalysis.blocked({ shapes: {} }, ctx({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem' } }))).toMatch(/PLS-SEM/);
    expect(nonlinearAnalysis.blocked({ shapes: {} }, ctx({ model: { ...model, moderations: [{ id: 'm', moderator: 'Loyalty', path: 'p' }] } }))).toMatch(/interaction/);
  });
  it('parses options strictly', () => {
    expect(nonlinearAnalysis.parseOptions(null)).toBeNull();
    expect(nonlinearAnalysis.parseOptions({ shapes: { 'Image→Loyalty': 'cubic', 'A→B': 'warp9', x: 3 } })).toEqual({ shapes: { 'Image→Loyalty': 'cubic', 'A→B': 'quadratic', x: 'quadratic' } });
    expect(nonlinearAnalysis.parseOptions({ shapes: [1] })).toEqual({ shapes: {} });
  });
  it('fits each path as chosen (default quadratic), equals OLS, and the fingerprint follows the shapes', async () => {
    const o = { shapes: { 'Image→Loyalty': 'linear' as const, 'Satisfaction→Loyalty': 'cubic' as const } };
    const r = await nonlinearAnalysis.run(o, ctx(), () => {});
    const loy = r.equations.find((e) => e.to === 'Loyalty')!;
    expect(loy.terms.map((t) => `${t.from}${t.power}`)).toEqual(['Image1', 'Satisfaction1', 'Satisfaction2', 'Satisfaction3']);
    const s = pls.scores;
    const ref = ols(s[2], [s[0], s[1], s[1].map((v) => v ** 2), s[1].map((v) => v ** 3)]);
    loy.terms.forEach((t, i) => expect(t.b).toBeCloseTo(ref.beta[i + 1], 12));
    expect(r.equations.find((e) => e.to === 'Satisfaction')!.terms.map((t) => t.power)).toEqual([1, 2]);
    expect(r.indices.paths).toHaveLength(3);
    expect(r.indices.paths[0].beta).toBeCloseTo(pls.pathCoef[0][1], 12);
    expect(nonlinearAnalysis.fingerprint(o, ctx())).not.toBe(nonlinearAnalysis.fingerprint({ shapes: {} }, ctx()));
    expect(nonlinearAnalysis.summary(o)).toBe('1 linear path, the others curved');
  });
  it('renders the tables and one chart per path', () => {
    const html = renderToStaticMarkup(<nonlinearAnalysis.View result={analyseNonlinear(pls, { shapes: {} })} options={{ shapes: {} }} current />);
    expect(html).toContain('Causality assessment indices');
    expect(html).toContain('Simpson’s paradox ratio (SPR)');
    expect(html).toContain('NLBCDR');
    expect(html.match(/class="chart-frame"/g)).toHaveLength(3);
  });
});
