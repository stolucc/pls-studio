// Product-indicator and orthogonalising interaction terms in the built-in engine, against plain seminr
// calls (interaction_term(method = product_indicator / orthogonal); scripts/validation/pls_interaction_methods.R).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapPls } from './bootstrap';
import { parseCsv } from './dataset';
import { estimatePls, indicatorProducts } from './pls';
import type { Dataset, ModelSpec, ModerationSpec } from './types';

const fx = join(__dirname, '__fixtures__');
const data = parseCsv(readFileSync(join(fx, 'mobi.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(fx, 'interaction_methods', 'reference.json'), 'utf8'));
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
type Method = NonNullable<ModerationSpec['method']>;

const model = (method: Method, two = false, extra: Partial<ModelSpec> = {}): ModelSpec => ({
  constructs: [
    { name: 'Image', mode: 'A', indicators: items('IMAG', 5) },
    { name: 'Expectation', mode: 'A', indicators: items('CUEX', 3) },
    { name: 'Value', mode: 'A', indicators: items('PERV', 2) },
    { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) },
    { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) },
  ],
  paths: [
    ['Image', 'Satisfaction'],
    ['Expectation', 'Satisfaction'],
    ['Value', 'Satisfaction'],
    ['Satisfaction', 'Loyalty'],
  ].map(([from, to]) => ({ from, to })),
  moderations: [
    { from: 'Image', moderator: 'Expectation', to: 'Satisfaction', method },
    ...(two ? [{ from: 'Value', moderator: 'Expectation', to: 'Satisfaction', method }] : []),
  ],
  ...extra,
});
// our construct names for seminr's "a*b"
const ours = (n: string) => n.replace('*', ' × ');

function check(method: Method, two: boolean) {
  const r = (two ? ref.two : ref.one)[method];
  const res = estimatePls(data, model(method, two));
  const ci = (n: string) => res.constructs.indexOf(ours(n));
  (r.constructs as string[]).forEach((f, i) =>
    (r.constructs as string[]).forEach((t, j) => {
      const v = r.paths[i][j];
      if (v !== 0) expect(res.pathCoef[ci(f)][ci(t)], `${f} → ${t}`).toBeCloseTo(v, 6);
    }),
  );
  for (const [c, v] of Object.entries(r.r2))
    expect(res.rSquared[ci(c)], `R² ${c}`).toBeCloseTo(v as number, 6);
  for (const [term, ws] of Object.entries(
    r.termWeights as Record<string, Record<string, number>>,
  )) {
    const ratios: number[] = [];
    for (const [item, v] of Object.entries(ws)) {
      const k = res.indicators.findIndex(
        (x) => x.name === item && res.constructs[x.construct] === ours(term),
      );
      expect(k, item).toBeGreaterThanOrEqual(0);
      expect(res.weights[k], `weight ${item}`).toBeCloseTo(v, 6);
      ratios.push(
        (r.termLoadings as Record<string, Record<string, number>>)[term][item] / res.loadings[k],
      );
    }
    // seminr reports the term's loadings after rescaling its scores (adjust_interaction); ours are the standardised loadings: proportional.
    ratios.forEach((q) => expect(q / ratios[0]).toBeCloseTo(1, 7));
  }
  for (const [item, v] of Object.entries(r.weights as Record<string, number>))
    expect(res.weights[res.indicators.findIndex((x) => x.name === item)]).toBeCloseTo(v, 6);
  return res;
}

describe('interaction terms by product indicators and orthogonalising (seminr)', () => {
  it('product indicators equal seminr', () => {
    const res = check('product_indicator', false);
    expect(res.moderations[0].method).toBe('product_indicator');
    expect(
      res.indicators.filter((x) => res.constructs[x.construct] === 'Image × Expectation'),
    ).toHaveLength(15);
  });
  it('orthogonalising equals seminr', () => {
    check('orthogonal', false);
  });
  it('two terms at once equal seminr, both methods', () => {
    check('product_indicator', true);
    check('orthogonal', true);
  });
  it('two-stage terms are unchanged (and say so)', () => {
    const res = estimatePls(data, model('two_stage'));
    expect(res.moderations[0].method).toBe('two_stage');
    const j = res.constructs.indexOf('Satisfaction');
    expect(res.pathCoef[res.constructs.indexOf('Image × Expectation')][j]).toBeCloseTo(
      ref.one.two_stage.paths[3][4],
      6,
    );
  });
  it('orthogonalised products are uncorrelated with every main-effect item', () => {
    const c = [
      data.cols[data.names.indexOf('IMAG1')],
      data.cols[data.names.indexOf('CUEX1')],
      data.cols[data.names.indexOf('CUEX2')],
    ];
    const [p] = indicatorProducts(c, [[0, 1]], true, null);
    for (const x of c.slice(0, 2)) {
      let s = 0;
      for (let r = 0; r < x.length; r++) s += p[r] * x[r];
      expect(s).toBeCloseTo(0, 8);
    }
    const plain = indicatorProducts(c, [[0, 1]], false, null)[0];
    expect(plain[0]).not.toBeCloseTo(p[0], 6);
  });
  it('bootstraps (terms rebuilt per sample) and refuses PLSc', () => {
    const b = bootstrapPls(
      data,
      model('orthogonal'),
      {},
      { samples: 10, seed: 1, confidence: 0.95 },
    );
    expect(b.failed).toBe(0);
    expect(b.stats.some((s) => s.key === 'weight:IMAG1*CUEX1')).toBe(true);
    expect(() => estimatePls(data, model('product_indicator'), { consistent: true })).toThrow(
      /PLSc/,
    );
  });
  it('with sampling weights: integer weights equal repeated rows', () => {
    const n = data.cols[0].length;
    const w = Float64Array.from({ length: n }, (_, r) => 1 + (r % 3));
    const weighted: Dataset = { names: [...data.names, 'sw'], cols: [...data.cols, w] };
    const repeated: Dataset = {
      names: data.names,
      cols: data.cols.map((c) =>
        Float64Array.from(Array.from(c).flatMap((v, r) => Array<number>(w[r]).fill(v))),
      ),
    };
    for (const method of ['product_indicator', 'orthogonal'] as const) {
      const a = estimatePls(weighted, model(method, false, { weights: 'sw' })),
        b = estimatePls(repeated, model(method));
      // (the term's path per unit of its indicators' sd differs by the n − 1 vs n_rep − 1 convention only)
      const t = a.constructs.indexOf('Image × Expectation');
      a.pathCoef.forEach((row, i) =>
        row.forEach((v, j) => expect(v).toBeCloseTo(b.pathCoef[i][j], i === t ? 3 : 9)),
      );
      a.weights.forEach((v, k) => expect(v).toBeCloseTo(b.weights[k], 9));
    }
  });
});
