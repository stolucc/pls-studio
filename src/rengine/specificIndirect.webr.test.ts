// Specific indirect effects of the PLS bootstrap (boot.R, PS_SPECIFIC_INDIRECT): per draw, the product
// of the path coefficients along each chain X -> M (-> M2 ...) -> Y.
// - seminr (desktop R: seminr's bootstrap needs worker processes): equal to seminr's own
//   specific_effect_significance() on the corporate reputation model (scripts/validation/specific_indirect.R).
// - cSEM: each original is the product of its paths; the specific effects of a pair add up to cSEM's
//   indirect effect; a pair with one chain has the same bootstrap distribution as cSEM's indirect effect
//   (also with BCa intervals, whose jackknife gets the same columns).
// - The mediation typology (reporting/mediation.ts) on the seminr run.
// Run natively: WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run --dir src src/rengine/specificIndirect.webr.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { BootstrapStat, Dataset, ModelSpec } from '../engine/types';
import { mediationPairs } from '../reporting/mediation';
import { near, same } from '../validation/record';
import { bootstrapR, parseBoot } from './analyses';
import { rCall, type RPackage } from './bridge';
import { plsRequest } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** `it` for a test that needs desktop R (seminr's bootstrap cannot run in the browser's R). */
const nativeOnlyIt: typeof it = (process.env.PS_NATIVE_R ? it : it.skip) as typeof it;

const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const comp = (name: string, ind: string[], mode: 'A' | 'B') => ({
  name,
  type: 'composite' as const,
  mode,
  indicators: ind,
});
const fac = (name: string, ind: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: ind,
});

const load = async (pkg: RPackage, name: string, na: number[]): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: pkg, name, na },
    pkg,
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
};
const statOf = (stats: BootstrapStat[], key: string) => {
  const s = stats.find((x) => x.key === key);
  if (!s) throw new Error(`no statistic ${key}`);
  return s;
};

describe('specific indirect effects (seminr, desktop R)', () => {
  nativeOnlyIt(
    'corporate reputation: equal to seminr’s specific_effect_significance; typology of COMP and LIKE → CUSA → CUSL',
    async () => {
      const ref = JSON.parse(
        readFileSync(
          join(__dirname, '..', 'engine', '__fixtures__', 'mediation', 'seminr_specific.json'),
          'utf8',
        ),
      );
      const data = await load('seminr', 'corp_rep_data', [-99]);
      const spec: ModelSpec = {
        constructs: [
          comp('QUAL', items('qual_', 8), 'B'),
          comp('PERF', items('perf_', 5), 'B'),
          comp('CSOR', items('csor_', 5), 'B'),
          comp('ATTR', items('attr_', 3), 'B'),
          comp('COMP', items('comp_', 3), 'A'),
          comp('LIKE', items('like_', 3), 'A'),
          comp('CUSA', ['cusa'], 'A'),
          comp('CUSL', items('cusl_', 3), 'A'),
        ],
        paths: [
          ...['QUAL', 'PERF', 'CSOR', 'ATTR'].flatMap((from) =>
            ['COMP', 'LIKE'].map((to) => ({ from, to })),
          ),
          ...['COMP', 'LIKE'].flatMap((from) => ['CUSA', 'CUSL'].map((to) => ({ from, to }))),
          { from: 'CUSA', to: 'CUSL' },
        ],
      };
      const options = {
        scheme: 'path' as const,
        consistent: false,
        tolerance: 1e-7,
        maxIter: 300,
        missing: 'mean' as const,
      };
      const boot = { samples: ref.nboot, seed: ref.seed, confidence: 0.95 };
      const r = await bootstrapR(
        data,
        spec,
        { kind: 'plsBoot', pkg: 'seminr', options, boot },
        () => '',
      );
      // Same draws (seminr's own bootstrap): only floating-point rounding of the products differs.
      for (const e of ref.specific) {
        const s = statOf(r.stats, `specific:${(e.chain as string[]).join(':')}`);
        const what = (e.chain as string[]).join(' → ');
        near(`${what}: estimate`, s.original, e.original, 1e-9);
        near(`${what}: bootstrap mean`, s.mean, e.mean, 1e-9);
        near(`${what}: bootstrap SD`, s.sd, e.sd, 1e-9);
        near(`${what}: t`, s.t, e.t, 1e-7);
        near(`${what}: 2.5% limit`, s.ciLow, e.ciLow, 1e-9);
        near(`${what}: 97.5% limit`, s.ciHigh, e.ciHigh, 1e-9);
      }
      const has = new Set(spec.paths.map((p) => `${p.from}>${p.to}`));
      const pairs = mediationPairs(
        r,
        spec.constructs.map((k) => k.name),
        (a, b) => has.has(`${a}>${b}`),
      );
      const typeOf = (chain: string[]) => {
        const pair = pairs.find((p) => p.from === chain[0] && p.to === chain[chain.length - 1])!;
        return pair.specific.find((e) => e.path.join(':') === chain.join(':'))!.cls.type;
      };
      // From seminr's own intervals (fixture): COMP's direct effect on CUSL includes zero, LIKE's does not.
      same('COMP → CUSA → CUSL: type', typeOf(['COMP', 'CUSA', 'CUSL']), 'indirect-only');
      same('LIKE → CUSA → CUSL: type', typeOf(['LIKE', 'CUSA', 'CUSL']), 'complementary');
    },
    900_000,
  );
});

describe('specific indirect effects (cSEM)', () => {
  const spec: ModelSpec = {
    constructs: [
      fac('IMAG', items('imag', 5)),
      fac('EXPE', items('expe', 5)),
      fac('SAT', items('sat', 4)),
      fac('LOY', items('loy', 4)),
    ],
    paths: [
      { from: 'IMAG', to: 'EXPE' },
      { from: 'IMAG', to: 'SAT' },
      { from: 'EXPE', to: 'SAT' },
      { from: 'SAT', to: 'LOY' },
      { from: 'IMAG', to: 'LOY' },
    ],
  };
  const options = {
    scheme: 'path' as const,
    consistent: false,
    tolerance: 1e-7,
    maxIter: 300,
    missing: 'casewise' as const,
  };

  it('products of the paths, adding up to cSEM’s indirect effect; one chain = cSEM’s indirect effect (percentile and BCa)', async () => {
    const data = await load('cSEM', 'satisfaction', []);
    for (const interval of ['percentile', 'bca'] as const) {
      const boot = { samples: 150, seed: 5, confidence: 0.95, interval };
      const r = await bootstrapR(
        data,
        spec,
        { kind: 'plsBoot', pkg: 'cSEM', options, boot },
        () => '',
      );
      const path = (a: string, b: string) => statOf(r.stats, `path:${a}:${b}`).original;
      const chains = [
        ['IMAG', 'EXPE', 'SAT'],
        ['IMAG', 'SAT', 'LOY'],
        ['IMAG', 'EXPE', 'SAT', 'LOY'],
        ['EXPE', 'SAT', 'LOY'],
      ];
      const specific = r.stats.filter((s) => s.group === 'specific');
      same(`${interval}: number of chains`, specific.length, chains.length);
      for (const ch of chains) {
        const s = statOf(r.stats, `specific:${ch.join(':')}`);
        let product = 1;
        for (let k = 0; k + 1 < ch.length; k++) product *= path(ch[k], ch[k + 1]);
        near(`${interval}: ${ch.join(' → ')} = product of its paths`, s.original, product, 1e-12);
        same(`${interval}: ${ch.join(' → ')} label`, s.label, ch.join(' → '));
      }
      // IMAG → LOY: two chains, adding up to cSEM's indirect effect.
      const sum =
        statOf(r.stats, 'specific:IMAG:SAT:LOY').original +
        statOf(r.stats, 'specific:IMAG:EXPE:SAT:LOY').original;
      near(
        `${interval}: IMAG → LOY specific effects add up`,
        sum,
        statOf(r.stats, 'indirect:IMAG:LOY').original,
        1e-12,
      );
      // IMAG → SAT has one chain: its draws are cSEM's indirect effect's draws.
      const one = statOf(r.stats, 'specific:IMAG:EXPE:SAT');
      const ind = statOf(r.stats, 'indirect:IMAG:SAT');
      near(`${interval}: one chain, SD`, one.sd, ind.sd, 1e-10);
      near(`${interval}: one chain, CI low`, one.ciLow, ind.ciLow, 1e-10);
      near(`${interval}: one chain, CI high`, one.ciHigh, ind.ciHigh, 1e-10);
    }
  }, 900_000);

  it('parallel chunks: each part carries the specific effects, and the summary recomputes them once', async () => {
    const data = await load('cSEM', 'satisfaction', []);
    const boot = { samples: 60, seed: 9, confidence: 0.95, chunkR: [30, 30], chunkSeed: [9, 10] };
    const req = { ...plsRequest(data, spec, options, 'cSEM'), boot };
    type Part = { names: string[]; values: unknown[][]; original: unknown[] };
    const parts: Part[] = [];
    for (const part of [1, 2]) {
      parts.push(await rCall<Part>('ps_pls_boot', { ...req, boot: { ...boot, part } }, 'cSEM'));
    }
    same(
      'a part has the specific columns',
      String(parts[0].names.includes('specific: IMAG -> EXPE -> SAT')),
      'true',
    );
    const draws = {
      names: parts[0].names,
      values: parts.flatMap((p) => p.values),
      original: parts[0].original,
    };
    const raw = await rCall<Record<string, unknown>>(
      'ps_pls_boot',
      { ...req, boot: { ...boot, draws } },
      'cSEM',
    );
    const r = parseBoot(raw as never, { package: 'cSEM', version: '' });
    const specific = r.stats.filter((s) => s.group === 'specific');
    same('chunked: number of chains (no duplicates)', specific.length, 4);
    const one = statOf(r.stats, 'specific:IMAG:EXPE:SAT');
    const ind = statOf(r.stats, 'indirect:IMAG:SAT');
    near('chunked: one chain, SD', one.sd, ind.sd, 1e-10);
    near('chunked: one chain, CI low', one.ciLow, ind.ciLow, 1e-10);
  }, 900_000);

  it('second-order construct (two-stage) and multiple imputation: products of the paths', async () => {
    const data = await load('cSEM', 'satisfaction', []);
    const hoc: ModelSpec = {
      constructs: [
        fac('IMAG', items('imag', 5)),
        fac('EXPE', items('expe', 5)),
        { name: 'HOC', type: 'composite', mode: 'B', indicators: [], components: ['IMAG', 'EXPE'] },
        fac('SAT', items('sat', 4)),
        fac('LOY', items('loy', 4)),
      ],
      paths: [
        { from: 'HOC', to: 'SAT' },
        { from: 'SAT', to: 'LOY' },
        { from: 'HOC', to: 'LOY' },
      ],
    };
    const boot = { samples: 60, seed: 3, confidence: 0.95 };
    const two = await bootstrapR(
      data,
      hoc,
      { kind: 'plsBoot', pkg: 'cSEM', options: { ...options, hocApproach: 'two_stage' }, boot },
      () => '',
    );
    const path = (r: typeof two, a: string, b: string) =>
      statOf(r.stats, `path:${a}:${b}`).original;
    near(
      'two-stage: HOC → SAT → LOY = product of its paths',
      statOf(two.stats, 'specific:HOC:SAT:LOY').original,
      path(two, 'HOC', 'SAT') * path(two, 'SAT', 'LOY'),
      1e-12,
    );
    // Multiple imputation: every 7th value of the first indicators missing; pooled by Rubin's rules.
    const holes: Dataset = {
      names: data.names,
      cols: data.cols.map((col, k) =>
        k < 3 ? Float64Array.from(col, (v, i) => (i % 7 === k ? NaN : v)) : col,
      ),
    };
    const mi = await bootstrapR(
      holes,
      spec,
      {
        kind: 'plsBoot',
        pkg: 'cSEM',
        options: { ...options, missing: 'mi', mi: { m: 2, seed: 1 } },
        boot: { samples: 30, seed: 3, confidence: 0.95 },
      },
      () => '',
    );
    same('MI: imputations', mi.imputations ?? 0, 2);
    same('MI: specific effects pooled', mi.stats.filter((s) => s.group === 'specific').length, 4);
  }, 900_000);
});
