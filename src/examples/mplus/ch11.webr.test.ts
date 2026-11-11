// Mplus User's Guide, chapter 11: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { growthInput } from '../../analyses/longitudinal';
import { computeColumn } from '../../data/compute';
import type { DataInfo } from '../../model/project';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { growthR } from '../../rengine/longitudinal';
import { cbScriptLavaan, estimateCbLavaan } from '../../rengine/lavaan';
import { callJson, withR } from '../../rengine/runtime';
import commonR from '../../rengine/R/common.R?raw';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, runCards, sameFit, samePrinted } from './testkit';
import type { MissingDataResult } from '../../rengine/screen';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** The example's data with its computed columns, and its growth card run as the app runs it. */
async function runCard(key: string) {
  const ex = example(key);
  let data = load(key);
  let info = {
    fileName: key,
    rows: data.cols[0].length,
    missingCells: 0,
    excluded: [],
  } as unknown as DataInfo;
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const { kind: _k, ...opts } = ex.panel as Extract<
    NonNullable<typeof ex.panel>,
    { kind: 'growth' }
  >;
  const input = growthInput(
    { ...opts, timeVarying: opts.timeVarying ?? [] },
    { settings: { ...DEFAULT_SETTINGS, ...ex.settings }, model: exampleModel(ex) },
  );
  expect(input.missing).toBe('fiml');
  expect(input.information).toBe('observed');
  return { r: await growthR(data, input), data };
}

it('ex11.1: FIML with a saturated missing-data correlate reproduces the Mplus output', async () => {
  evidence('ex11.1', 'Longitudinal', ['lavaan']);
  const { r } = await runCard('ex11.1');
  const want = MPLUS['ex11.1'];
  // Mplus counts the growth model's 9 parameters; its log-likelihood, AIC and BIC include z's 6 (mean, variance, 4 covariances), as lavaan's.
  same('free parameters with the auxiliary part', r.fit.npar!, want.fit.npar! + 6);
  sameFit({ ...r.fit, npar: undefined }, { ...want.fit, npar: undefined });
  expect(r.n).toBe(200);
  samePrinted(r.estimates, want.estimates, 'ex11.1');
}, 600_000);

it('ex11.4: the pattern-mixture model reproduces the Mplus output (one standard error as stated)', async () => {
  evidence('ex11.4', 'Longitudinal', ['lavaan']);
  const { r, data } = await runCard('ex11.4');
  // The dropout dummies as Mplus's DDROPOUT makes them (its descriptive statistics: 3.3%, 3.5%, 5.4%, 4.0%).
  const count = (d: string) =>
    Array.from(data.cols[data.names.indexOf(d)]).reduce((a, v) => a + v, 0);
  expect([1, 2, 3, 4, 5].map((t) => count(`d${t}`))).toEqual([33, 35, 54, 40, 151]);
  const want = MPLUS['ex11.4'];
  sameFit(r.fit, want.fit);
  const shared = (p: { lhs: string; op: string; rhs: string }) =>
    p.lhs === 's' && p.op === '~' && (p.rhs === 'd1' || p.rhs === 'd2');
  samePrinted(
    r.estimates,
    want.estimates.filter((p) => !shared(p)),
    'ex11.4',
  );
  samePrinted(r.estimates, want.estimates.filter(shared), 'ex11.4 shared slope shift', {
    ses: false,
  });
  // Mplus prints 0.156; lavaan's observed information (and a numerical Hessian of the likelihood) give 0.160, as the card states.
  for (const d of ['d1', 'd2'])
    near(
      `SE of s ~ ${d} (stated)`,
      r.estimates.find((e) => e.lhs === 's' && e.op === '~' && e.rhs === d)!.se!,
      0.16,
      0.0006,
    );
}, 600_000);

/** ex11.2: what Mplus prints (pattern frequencies in its order, coverage and EM covariances as lower triangles, z1–z5,
 *  y0–y5, d1–d5; the dropout tables: label, number observed, mean, SD). */
const PRINTED_112 = {
  freq: [
    299, 39, 29, 13, 74, 30, 21, 30, 60, 21, 17, 13, 25, 14, 16, 35, 70, 8, 6, 5, 21, 14, 10, 24,
    13, 6, 7, 9, 11, 19, 8, 33,
  ],
  coverage: [
    [1.0],
    [1.0, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    [0.736, 0.736, 0.736, 0.736, 0.736, 0.736, 0.736],
    [0.693, 0.693, 0.693, 0.693, 0.693, 0.693, 0.535, 0.693],
    [0.615, 0.615, 0.615, 0.615, 0.615, 0.615, 0.491, 0.469, 0.615],
    [0.724, 0.724, 0.724, 0.724, 0.724, 0.724, 0.562, 0.555, 0.516, 0.724],
    [0.687, 0.687, 0.687, 0.687, 0.687, 0.687, 0.541, 0.53, 0.501, 0.573, 0.687],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.736, 0.693, 0.615, 0.724, 0.687, 1.0],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.736, 0.693, 0.615, 0.724, 0.687, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.736, 0.693, 0.615, 0.724, 0.687, 1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.736, 0.693, 0.615, 0.724, 0.687, 1.0, 1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.736, 0.693, 0.615, 0.724, 0.687, 1.0, 1.0, 1.0, 1.0, 1.0],
  ],
  means: [
    0.264, 0.307, 0.385, 0.276, 0.313, 2.038, 0.904, -0.215, -1.417, -2.46, -3.652, 0.033, 0.035,
    0.054, 0.04, 0.151,
  ],
  cov: [
    [0.194],
    [0.025, 0.213],
    [0.038, 0.043, 0.237],
    [0.029, 0.053, 0.071, 0.2],
    [0.035, 0.054, 0.078, 0.076, 0.215],
    [0.003, 0.032, 0.059, 0.046, 0.06, 0.692],
    [0.003, 0.058, 0.103, 0.089, 0.103, 0.218, 0.649],
    [0.043, 0.006, 0.14, 0.122, 0.148, 0.223, 0.405, 0.917],
    [0.013, 0.064, 0.012, 0.084, 0.139, 0.175, 0.333, 0.618, 1.099],
    [0.032, 0.082, 0.175, 0.012, 0.158, 0.179, 0.434, 0.763, 1.016, 1.866],
    [-0.015, 0.064, 0.159, 0.121, 0.023, 0.118, 0.488, 0.833, 1.089, 1.502, 2.274],
    [0.024, 0.023, 0.02, 0.024, 0.023, 0.013, 0.0, 0.0, -0.001, -0.001, -0.001, 0.032],
    [-0.009, 0.024, 0.022, 0.025, 0.024, 0.006, 0.021, 0.0, -0.001, -0.001, -0.001, -0.001, 0.034],
    [
      0.01, -0.017, 0.033, 0.039, 0.037, 0.021, 0.037, 0.061, 0.001, 0.002, 0.002, -0.002, -0.002,
      0.051,
    ],
    [
      0.003, 0.01, -0.015, 0.029, 0.027, 0.002, 0.007, 0.026, 0.042, 0.004, 0.004, -0.001, -0.001,
      -0.002, 0.038,
    ],
    [
      0.007, 0.014, 0.019, -0.042, 0.104, 0.018, 0.038, 0.061, 0.097, 0.153, 0.019, -0.005, -0.005,
      -0.008, -0.006, 0.128,
    ],
  ],
  dropout: {
    y0: [
      ['Dropouts after time 1', 33, 2.446, 0.799],
      ['Non-dropouts after time 1', 967, 2.024, 0.83],
      ['Total dropouts', 313, 2.23, 0.806],
      ['Dropouts no intermittent missing', 150, 2.235, 0.803],
      ['Dropouts intermittent missing', 163, 2.226, 0.811],
      ['Total non-dropouts', 687, 1.95, 0.83],
      ['Non-dropouts complete data', 299, 1.906, 0.803],
      ['Non-dropouts intermittent missing', 388, 1.984, 0.849],
      ['Total sample', 1000, 2.038, 0.832],
    ],
    y1: [
      ['Dropouts after time 2', 35, 1.51, 0.692],
      ['Non-dropouts after time 2', 701, 0.869, 0.799],
      ['Total dropouts', 195, 1.273, 0.809],
      ['Dropouts no intermittent missing', 117, 1.314, 0.813],
      ['Dropouts intermittent missing', 78, 1.212, 0.805],
      ['Total non-dropouts', 541, 0.765, 0.761],
      ['Non-dropouts complete data', 299, 0.63, 0.747],
      ['Non-dropouts intermittent missing', 242, 0.933, 0.747],
      ['Total sample', 736, 0.9, 0.806],
    ],
    y2: [
      ['Dropouts after time 3', 54, 0.923, 0.686],
      ['Non-dropouts after time 3', 639, -0.321, 0.945],
      ['Total dropouts', 163, 0.495, 0.879],
      ['Dropouts no intermittent missing', 82, 0.424, 0.953],
      ['Dropouts intermittent missing', 81, 0.567, 0.797],
      ['Total non-dropouts', 530, -0.445, 0.908],
      ['Non-dropouts complete data', 299, -0.621, 0.867],
      ['Non-dropouts intermittent missing', 231, -0.216, 0.91],
      ['Total sample', 693, -0.224, 0.985],
    ],
    y3: [
      ['Dropouts after time 4', 40, -0.359, 0.881],
      ['Non-dropouts after time 4', 575, -1.512, 1.055],
      ['Total dropouts', 114, -0.599, 0.955],
      ['Dropouts no intermittent missing', 52, -0.7, 0.993],
      ['Dropouts intermittent missing', 62, -0.515, 0.921],
      ['Total non-dropouts', 501, -1.627, 1.017],
      ['Non-dropouts complete data', 299, -1.728, 0.998],
      ['Non-dropouts intermittent missing', 202, -1.479, 1.03],
      ['Total sample', 615, -1.437, 1.082],
    ],
    y4: [
      ['Dropouts after time 5', 151, -1.446, 1.315],
      ['Non-dropouts after time 5', 573, -2.747, 1.298],
      ['Total dropouts', 151, -1.446, 1.315],
      ['Dropouts no intermittent missing', 39, -1.911, 1.304],
      ['Dropouts intermittent missing', 112, -1.284, 1.286],
      ['Total non-dropouts', 573, -2.747, 1.298],
      ['Non-dropouts complete data', 299, -2.956, 1.281],
      ['Non-dropouts intermittent missing', 274, -2.52, 1.281],
      ['Total sample', 724, -2.476, 1.404],
    ],
    y5: [
      ['Total non-dropouts', 687, -3.685, 1.545],
      ['Non-dropouts complete data', 299, -4.051, 1.499],
      ['Non-dropouts intermittent missing', 388, -3.403, 1.522],
      ['Total sample', 687, -3.685, 1.545],
    ],
    z1: [
      ['Dropouts after time 2', 35, 0.0, 0.0],
      ['Non-dropouts after time 2', 965, 0.274, 0.446],
      ['Total dropouts', 280, 0.304, 0.461],
      ['Dropouts no intermittent missing', 280, 0.304, 0.461],
      ['Dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total non-dropouts', 687, 0.213, 0.409],
      ['Non-dropouts complete data', 687, 0.213, 0.409],
      ['Non-dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total sample', 967, 0.239, 0.427],
    ],
    z2: [
      ['Dropouts after time 3', 54, 0.0, 0.0],
      ['Non-dropouts after time 3', 946, 0.325, 0.468],
      ['Total dropouts', 245, 0.335, 0.473],
      ['Dropouts no intermittent missing', 245, 0.335, 0.473],
      ['Dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total non-dropouts', 687, 0.229, 0.42],
      ['Non-dropouts complete data', 687, 0.229, 0.42],
      ['Non-dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total sample', 932, 0.256, 0.437],
    ],
    z3: [
      ['Dropouts after time 4', 40, 0.0, 0.0],
      ['Non-dropouts after time 4', 960, 0.401, 0.49],
      ['Total dropouts', 191, 0.403, 0.492],
      ['Dropouts no intermittent missing', 191, 0.403, 0.492],
      ['Dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total non-dropouts', 687, 0.271, 0.445],
      ['Non-dropouts complete data', 687, 0.271, 0.445],
      ['Non-dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total sample', 878, 0.3, 0.458],
    ],
    z4: [
      ['Dropouts after time 5', 151, 0.0, 0.0],
      ['Non-dropouts after time 5', 849, 0.325, 0.469],
      ['Total dropouts', 151, 0.0, 0.0],
      ['Dropouts no intermittent missing', 151, 0.0, 0.0],
      ['Dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total non-dropouts', 687, 0.166, 0.372],
      ['Non-dropouts complete data', 687, 0.166, 0.372],
      ['Non-dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total sample', 838, 0.136, 0.343],
    ],
    z5: [
      ['Total non-dropouts', 687, 0.0, 0.0],
      ['Non-dropouts complete data', 687, 0.0, 0.0],
      ['Non-dropouts intermittent missing', 0, 0.0, 0.0],
      ['Total sample', 687, 0.0, 0.0],
    ],
  },
} as {
  freq: number[];
  coverage: number[][];
  means: number[];
  cov: number[][];
  dropout: Record<string, [string, number, number, number][]>;
};

it('ex11.2: the missing-data card reproduces Mplus’s TYPE = BASIC with DDROPOUT: patterns, coverage, EM estimates and the dropout descriptives', async () => {
  evidence('ex11.2', 'Missing data', ['lavaan']);
  const [r] = await runCards<MissingDataResult>('ex11.2');
  expect(
    r.warnings.filter((w) => !/singular|smallest eigenvalue|standard deviation is zero/i.test(w)),
  ).toEqual([]);
  const want = PRINTED_112;
  same('number of missing-data patterns', r.patterns.length, 32);
  want.freq.forEach((f, k) => same(`frequency of pattern ${k + 1}`, r.patterns[k].n, f));
  // (Mplus's order: pattern 2 misses y5 only, pattern 5 y3 only)
  expect(r.patterns[1].observed.map((o, i) => (o ? '' : r.variables[i])).filter(Boolean)).toEqual([
    'y5',
  ]);
  expect(r.patterns[4].observed.map((o, i) => (o ? '' : r.variables[i])).filter(Boolean)).toEqual([
    'y3',
  ]);
  want.coverage.forEach((row, i) =>
    row.forEach((x, j) =>
      near(`coverage ${r.variables[i]}, ${r.variables[j]}`, r.coverage[i][j], x, 0.0005),
    ),
  );
  want.means.forEach((x, i) => near(`EM mean of ${r.variables[i]}`, r.em.means[i], x, 0.001));
  want.cov.forEach((row, i) =>
    row.forEach((x, j) =>
      near(`EM covariance ${r.variables[i]}, ${r.variables[j]}`, r.em.cov[i][j], x, 0.001),
    ),
  );
  // Singular at the EM solution (the d's are functions of the missingness): no finite maximum, no log-likelihood shown.
  expect(r.em.singular).toBe(true);
  expect(r.em.loglik).toBeNull();
  const d = r.dropout!;
  same('dropouts', d.dropouts, 313);
  same('non-dropouts with complete data', d.nonDropoutsComplete, 299);
  same('non-dropouts with intermittent missing', d.nonDropoutsIntermittent, 388);
  expect(d.byTime).toEqual([33, 35, 54, 40, 151]);
  const { dropoutLabel } = await import('../../analyses/missingData');
  let rows = 0;
  for (const v of [...d.set1, ...d.set2]) {
    const printed = want.dropout[v.variable];
    expect(printed, v.variable).toBeDefined();
    same(`${v.variable}: rows`, v.rows.length, printed.length);
    v.rows.forEach((row, k) => {
      const [label, n, mean, sd] = printed[k];
      expect(dropoutLabel(row.group, row.time).trim()).toBe(label);
      same(`${v.variable}, ${label}: number observed`, row.n, n);
      // (Mplus prints 0.000 for a group with no one in it)
      if (n > 0) {
        near(`${v.variable}, ${label}: mean`, row.mean!, mean, 0.0005);
        near(`${v.variable}, ${label}: SD`, row.sd ?? 0, sd, 0.0005);
      }
      rows++;
    });
  }
  same('rows of the dropout tables', rows, 89);
}, 600_000);

/** ex11.5: Mplus's averages over its 10 imputed data sets (RESULTS FOR BASIC ANALYSIS: means and covariances). */
const BASIC_115 = ['x1', 'x2', 'y1', 'y2', 'y3', 'y4', 'z1', 'z2', 'z3', 'z4', 'z5'];
const MEANS_115 = [
  0.526, -0.004, -0.042, -0.109, -0.037, -0.023, 0.035, -0.028, -0.107, 0.031, -0.035,
];
const COV_115 = [
  [0.249],
  [0.266, 2.193],
  [0.181, 1.151, 2.205],
  [0.22, 1.132, 1.153, 2.222],
  [0.23, 1.07, 1.07, 1.098, 2.006],
  [0.238, 1.101, 1.083, 1.219, 1.112, 2.279],
  [0.067, 0.429, 0.367, 0.37, 0.427, 0.473, 0.936],
  [0.108, 0.541, 0.491, 0.502, 0.357, 0.521, 0.021, 1.031],
  [0.078, 0.343, 0.4, 0.442, 0.32, 0.428, -0.039, -0.049, 0.98],
  [0.115, 0.42, 0.492, 0.535, 0.471, 0.41, -0.025, -0.057, -0.007, 0.986],
  [0.069, 0.502, 0.557, 0.439, 0.521, 0.431, -0.084, 0.007, -0.001, 0.091, 0.949],
];

it('ex11.5: means and covariances averaged over 10 data sets from the joint H1 imputation agree with Mplus within Monte Carlo error', async () => {
  evidence('ex11.5', 'CB-SEM', ['lavaan', 'lavaan.mi']);
  const ex = example('ex11.5');
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const data = load('ex11.5');
  const mi = {
    m: st.miImputations,
    seed: st.seed,
    method: st.miMethod,
    auxiliary: st.miAuxiliary,
    nominal: st.miNominal,
  };
  expect(mi).toMatchObject({ m: 10, method: 'joint', nominal: ['x1'] });
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', mi);
  expect(r.converged).toBe(true);
  const script = await cbScriptLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', mi);
  expect(script).toContain('ps_joint_impute <- function');
  expect(script).toContain('imp <- ps_joint_impute(data, m = 10, seed = 5, categorical = c("x1"))');
  // The imputation itself, with many data sets: what a 10-data-set average is on average (E) and its between variance B.
  const cols = BASIC_115.map((n) =>
    Array.from(data.cols[data.names.indexOf(n)], (v) => (Number.isNaN(v) ? null : v)),
  );
  const big = (await withR(['jsonlite'], { common: commonR }, (webR) =>
    callJson(
      webR,
      `
    req <- jsonlite::fromJSON(req, simplifyVector = FALSE)
    d <- as.data.frame(setNames(lapply(req$cols, function(x) as.numeric(unlist(lapply(x, function(v) if (is.null(v)) NA else v)))), req$names))
    imp <- ps_joint_impute(d, m = 200, seed = 99, categorical = "x1", thin = 20)
    st <- sapply(imp, function(D) { S <- stats::cov(D) * (nrow(D) - 1) / nrow(D); c(colMeans(D), S[lower.tri(S, diag = TRUE)]) })
    ps_json(list(E = rowMeans(st), B = apply(st, 1, stats::var)))`,
      { cols, names: BASIC_115 },
    ),
  )) as { E: number[]; B: number[] };
  const est = (op: string, a: string, b: string) =>
    r.estimates.find(
      (e) => e.op === op && ((e.lhs === a && e.rhs === b) || (e.lhs === b && e.rhs === a)),
    )!;
  // (the statistics in the order R's lower triangle lists them: means, then the covariance matrix column by column)
  const keys: { op: string; a: string; b: string; want: number }[] = BASIC_115.map((a, i) => ({
    op: '~1',
    a,
    b: '',
    want: MEANS_115[i],
  }));
  for (let j = 0; j < 11; j++)
    for (let i = j; i < 11; i++)
      keys.push({ op: '~~', a: BASIC_115[i], b: BASIC_115[j], want: COV_115[i][j] });
  let n = 0,
    z2 = 0,
    zmax = 0;
  keys.forEach((k, idx) => {
    const e =
      k.op === '~1'
        ? r.estimates.find((x) => x.op === '~1' && x.lhs === k.a)!
        : est('~~', k.a, k.b);
    expect(e, `${k.a} ${k.op} ${k.b}`).toBeTruthy();
    const B = big.B[idx];
    // complete variables (z1–z5): no imputation, the sample values (to Mplus's rounding)
    if (B < 1e-12) {
      near(`${k.a} ${k.op} ${k.b} (complete data)`, e.est, k.want, 0.0006);
      return;
    }
    // the pooled estimate against Mplus's: two averages over 10 imputed data sets, plus Mplus's rounding
    near(
      `${k.a} ${k.op} ${k.b} (pooled over 10 data sets; Mplus by its own imputations)`,
      e.est,
      k.want,
      3 * Math.sqrt((2 * B) / 10) + 0.0005,
    );
    const z = (k.want - big.E[idx]) / Math.sqrt(B / 10);
    n++;
    z2 += z * z;
    zmax = Math.max(zmax, Math.abs(z));
  });
  expect(n).toBe(57);
  // Mplus's averages as draws of a 10-data-set average of this imputation: within 2.6 SDs, mean squared z near 1.
  near('largest |z| of Mplus’s averages against the imputation’s expectation', zmax, 0, 2.6);
  near('mean squared z (1 for draws from the same imputation)', z2 / n, 1, 0.35);
}, 900_000);

it('ex11.6: growth on 10 imputed data sets (mice, Bayesian normal regression; lavaan.mi pooling) agrees with Mplus within Monte Carlo error', async () => {
  evidence('ex11.6', 'CB-SEM', ['lavaan', 'mice', 'lavaan.mi']);
  const ex = example('ex11.6');
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const data = load('ex11.6');
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', {
    m: st.miImputations,
    seed: st.seed,
    method: st.miMethod,
    auxiliary: st.miAuxiliary,
    nominal: st.miNominal,
  });
  expect(r.converged).toBe(true);
  const script = await cbScriptLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', {
    m: st.miImputations,
    seed: st.seed,
    method: st.miMethod,
    auxiliary: st.miAuxiliary,
    nominal: st.miNominal,
  });
  expect(script).toContain('defaultMethod = c("norm", "logreg", "polyreg", "polr")');
  expect(script).toMatch(/data\[\[v\]\] <- factor\(data\[\[v\]\]\)/);
  // The between-imputation variance B of each estimate, from an independent run of the same imputation model in the
  // same R: the difference of two pooled estimates over 10 data sets has SD √(2B/10).
  const cols = ['y1', 'y2', 'y3', 'y4', 'x1', 'x2'].map((n) =>
    Array.from(data.cols[data.names.indexOf(n)], (v) => (Number.isNaN(v) ? null : v)),
  );
  const B = (await withR(['jsonlite', 'mice', 'lavaan'], { common: commonR }, (webR) =>
    callJson(
      webR,
      `
    req <- jsonlite::fromJSON(req, simplifyVector = FALSE)
    d <- as.data.frame(setNames(lapply(req$cols, function(x) as.numeric(unlist(lapply(x, function(v) if (is.null(v)) NA else v)))), c("y1","y2","y3","y4","x1","x2")))
    d$x1 <- factor(d$x1)
    imp <- mice::mice(d, m = 20, seed = 2, printFlag = FALSE, defaultMethod = c("norm", "logreg", "polyreg", "polr"))
    m <- 'i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4\ns =~ 0*y1 + 1*y2 + 2*y3 + 3*y4\ni + s ~ x1 + x2'
    E <- sapply(1:20, function(k) { dd <- mice::complete(imp, k); dd$x1 <- as.numeric(as.character(dd$x1)); p <- lavaan::parameterEstimates(lavaan::growth(m, dd)); setNames(c(p$est, p$se), c(paste(p$lhs, p$op, p$rhs), paste("se", p$lhs, p$op, p$rhs))) })
    ps_json(as.list(apply(E, 1, stats::var)))`,
      { cols },
    ),
  )) as Record<string, number>;
  let n = 0;
  for (const p of MPLUS['ex11.6'].estimates) {
    if (p.se === 0) continue;
    const key = `${p.lhs} ${p.op} ${p.rhs}`,
      alt = `${p.rhs} ${p.op} ${p.lhs}`;
    const b = B[key] ?? B[alt],
      bse = B[`se ${key}`] ?? B[`se ${alt}`];
    expect(b, key).toBeDefined();
    const e = r.estimates.find(
      (x) =>
        x.op === p.op &&
        ((x.lhs === p.lhs && x.rhs === p.rhs) || (x.lhs === p.rhs && x.rhs === p.lhs)),
    )!;
    expect(e, key).toBeTruthy();
    // Monte Carlo error of the pooled estimate, plus Mplus's printed rounding.
    near(
      `${key} (pooled; Mplus by its own imputations)`,
      e.est,
      p.est,
      3 * Math.sqrt((2 * b) / 10) + 0.0005,
    );
    // A pooled SE varies with the imputations mostly through the estimated between variance: T = W + 1.1B, and B
    // estimated from 10 data sets has SD B·√(2/9), so SE = √T has Monte Carlo SD about 1.1·B·√(2/9) / (2·SE) (plus W's, √(B_se/10)).
    near(
      `SE of ${key}`,
      e.se!,
      p.se,
      3 * Math.sqrt(2) * ((1.1 * b * Math.sqrt(2 / 9)) / (2 * p.se) + Math.sqrt(bse / 10)) + 0.0005,
    );
    n++;
  }
  expect(n).toBeGreaterThanOrEqual(13);
}, 900_000);
