// Two-level CB-SEM through lavaan in webR. The reference is lavaan's own
// two-level syntax for the same models (lavaan's Demo.twolevel), run in the
// same session: our generated model must give its results (to 1e-4; the data
// travel through a CSV file).
//
// Desktop lavaan 0.6-16 (scripts/validation/twolevel.R) differs from webR's
// lavaan 0.7-3 for two-level models with identical syntax (chi-square 4.969
// vs 4.962 with the same structure between, 0 vs 1.439 with a saturated
// between level), so those values are not the reference here.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import commonR from './R/common.R?raw';
import { cbScriptLavaan, estimateCbLavaan, invarianceR } from './lavaan';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'twolevel');
const data = parseCsv(readFileSync(join(DIR, 'demo_twolevel.csv'), 'utf8')).dataset;
const cov = (name: string) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [name],
  covariate: true,
});
const spec = (between: 'same' | 'saturated'): ModelSpec => ({
  constructs: [
    { name: 'f', type: 'factor', mode: 'A', indicators: ['y1', 'y2', 'y3'] },
    cov('x1'),
    cov('x2'),
  ],
  paths: [
    { from: 'x1', to: 'f' },
    { from: 'x2', to: 'f' },
  ],
  multilevel: { column: 'cluster', between },
});
const SYNTAX = {
  same: 'level: 1\\n  f =~ y1 + y2 + y3\\n  f ~ x1 + x2\\nlevel: 2\\n  f_b =~ y1 + y2 + y3\\n  f_b ~ x1 + x2',
  saturated:
    'level: 1\\n  f =~ y1 + y2 + y3\\n  f ~ x1 + x2\\nlevel: 2\\n  y1 ~~ y1 + y2 + y3 + x1 + x2\\n  y2 ~~ y2 + y3 + x1 + x2\\n  y3 ~~ y3 + x1 + x2\\n  x1 ~~ x1 + x2\\n  x2 ~~ x2',
};

it.each(['same', 'saturated'] as const)(
  'between level %s: identical to lavaan’s own two-level syntax',
  async (between) => {
    const r = await estimateCbLavaan(data, spec(between), 'casewise', 'ML');
    const ref = (await withR(['jsonlite', 'lavaan'], { common: commonR }, (webR) =>
      callJson(
        webR,
        `
    f <- lavaan::sem("${SYNTAX[between]}", lavaan::Demo.twolevel, cluster = "cluster")
    pe <- lavaan::parameterEstimates(f); pe <- pe[pe$op %in% c("=~", "~"), ]
    ps_json(list(chisq = unname(lavaan::fitMeasures(f, "chisq")), df = unname(lavaan::fitMeasures(f, "df")), icc = as.list(lavaan::lavInspect(f, "icc")),
      estimates = lapply(seq_len(nrow(pe)), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], level = pe$level[i], est = pe$est[i], se = pe$se[i]))))`,
        null,
      ),
    )) as {
      chisq: number;
      df: number;
      icc: Record<string, number>;
      estimates: { lhs: string; op: string; rhs: string; level: number; est: number; se: number }[];
    };
    expect(r.fit.chisq).toBeCloseTo(ref.chisq, 6);
    expect(r.fit.df).toBe(ref.df);
    expect(r.groups!.labels).toEqual(['Within', 'Between']);
    expect(r.groups!.levels).toBe(true);
    for (const e of ref.estimates) {
      const mine = r.groups!.results[e.level - 1].estimates.find(
        (x) => x.lhs === e.lhs.replace(/_b$/, '') && x.op === e.op && x.rhs === e.rhs,
      );
      expect(mine, `level ${e.level}: ${e.lhs} ${e.op} ${e.rhs}`).toBeTruthy();
      expect(mine!.est).toBeCloseTo(e.est, 4);
      if (e.se > 0) expect(mine!.se!).toBeCloseTo(e.se, 4);
    }
    for (const [k, v] of Object.entries(ref.icc)) expect(r.groups!.icc![k]).toBeCloseTo(v, 6);
    const script = await cbScriptLavaan(data, spec(between), 'casewise', 'ML');
    expect(script).toContain('level: 2');
    expect(script).toContain('cluster = "cluster"');
  },
  600_000,
);

it('two levels with groups, labels and a defined parameter: identical to lavaan’s own syntax', async () => {
  // Groups at the cluster level: clusters 1-100 and 101-200.
  const cl = data.cols[data.names.indexOf('cluster')];
  const grouped = {
    names: [...data.names, 'g'],
    cols: [...data.cols, cl.map((v) => (v <= 100 ? 1 : 2))],
  };
  const s: ModelSpec = {
    constructs: [
      {
        name: 'f',
        type: 'factor',
        mode: 'A',
        indicators: ['y1', 'y2', 'y3'],
        loadingLabels: { y2: 'a' },
      },
      cov('x1'),
    ],
    paths: [{ from: 'x1', to: 'f' }],
    multilevel: { column: 'cluster', between: 'same' },
    multigroup: { column: 'g', invariance: 'metric', free: [] },
    defined: [{ name: 'twice', expr: '2*a' }],
  };
  const r = await estimateCbLavaan(grouped, s, 'casewise', 'ML');
  const ref = (await withR(['jsonlite', 'lavaan'], { common: commonR }, (webR) =>
    callJson(
      webR,
      `
    d <- lavaan::Demo.twolevel; d$g <- ifelse(d$cluster <= 100, 1, 2)
    lv <- "level: 1\\n  f =~ y1 + a*y2 + y3\\n  f ~ x1\\nlevel: 2\\n  f_b =~ y1 + a*y2 + y3\\n  f_b ~ x1\\n"
    m <- paste0("group: 1\\n", lv, "group: 2\\n", lv, "twice := 2*a")
    f <- lavaan::sem(m, d, cluster = "cluster", group = "g", group.equal = "loadings")
    pe <- lavaan::parameterEstimates(f)
    ps_json(list(chisq = unname(lavaan::fitMeasures(f, "chisq")), df = unname(lavaan::fitMeasures(f, "df")),
      twice = pe$est[pe$op == ":="], twice_se = pe$se[pe$op == ":="],
      estimates = lapply(which(pe$op %in% c("=~", "~")), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], block = pe$block[i], est = pe$est[i], se = pe$se[i]))))`,
      null,
    ),
  )) as {
    chisq: number;
    df: number;
    twice: number;
    twice_se: number;
    estimates: { lhs: string; op: string; rhs: string; block: number; est: number; se: number }[];
  };
  expect(r.fit.chisq).toBeCloseTo(ref.chisq, 6);
  expect(r.fit.df).toBe(ref.df);
  expect(r.groups!.labels).toEqual(['1 · Within', '1 · Between', '2 · Within', '2 · Between']);
  expect(r.groups!.results.map((x) => x.n)).toEqual([1250, 100, 1250, 100]); // people within, clusters between, per group
  for (const e of ref.estimates) {
    const mine = r.groups!.results[e.block - 1].estimates.find(
      (x) => x.lhs === e.lhs.replace(/_b$/, '') && x.op === e.op && x.rhs === e.rhs,
    );
    expect(mine, `block ${e.block}: ${e.lhs} ${e.op} ${e.rhs}`).toBeTruthy();
    expect(mine!.est).toBeCloseTo(e.est, 4);
    if (e.se > 0) expect(mine!.se!).toBeCloseTo(e.se, 4);
  }
  const def = r.estimates.find((x) => x.kind === 'defined')!;
  expect(def.est).toBeCloseTo(ref.twice, 6);
  expect(def.se!).toBeCloseTo(ref.twice_se, 5);
  // A defined parameter belongs to the whole model: listed with every group and level.
  for (const b of r.groups!.results)
    expect(b.estimates.filter((x) => x.kind === 'defined').map((x) => x.lhs)).toEqual(['twice']);
}, 600_000);

it('measurement invariance across groups of a two-level model: four nested models', async () => {
  const cl = data.cols[data.names.indexOf('cluster')];
  const grouped = {
    names: [...data.names, 'g'],
    cols: [...data.cols, cl.map((v) => (v <= 100 ? 1 : 2))],
  };
  const r = await invarianceR(
    grouped,
    { ...spec('same'), multigroup: { column: 'g', invariance: 'configural', free: [] } },
    'casewise',
    'ML',
  );
  expect(r.levels.map((l: { level: string }) => l.level)).toEqual([
    'configural',
    'metric',
    'scalar',
    'strict',
  ]);
  const df = r.levels.map((l: { df: number }) => l.df);
  for (let i = 1; i < df.length; i++) expect(df[i]).toBeGreaterThan(df[i - 1]);
}, 900_000);
