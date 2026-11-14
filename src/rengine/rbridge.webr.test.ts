// What the R bridge sends back and exports, checked end to end (the R bridge audit of
// 2026-11): JSON shapes that must not depend on how many elements there are, and
// exported scripts that reproduce what the app reports. Run with npm run test:webr.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { McDesign } from '../engine/montecarlo';
import type { ModelSpec } from '../engine/types';
import { analysisScript, bootChunked, bootstrapR } from './analyses';
import { parallelism, rCall } from './bridge';
import { useHelper } from './helper';
import { cbRequest, cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { mcChunkRequest, runMcChunkR } from './mc';
import { helperLibrary } from './nativeR';
import { estimatePlsR, plsScriptR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const hs = parseCsv(
  readFileSync(
    join(
      __dirname,
      '..',
      'engine',
      '__fixtures__',
      'validation',
      'data',
      'holzinger_swineford.csv',
    ),
    'utf8',
  ),
).dataset;

const oneFactor: ModelSpec = {
  constructs: [{ name: 'visual', type: 'factor', mode: 'A', indicators: ['x1', 'x2', 'x3'] }],
  paths: [],
};

it('a one-factor CFA sends its construct names as an array', async () => {
  const raw = await rCall<Record<string, any>>(
    'ps_cb',
    cbRequest(hs, oneFactor, 'casewise', 'ML'),
    'lavaan',
  );
  expect(raw.constructs).toEqual(['visual']);
  const r = await estimateCbLavaan(hs, oneFactor, 'casewise', 'ML');
  expect(r.constructs).toEqual(['visual']);
  expect(r.reliability).toHaveLength(1);
}, 600_000);

it('a Monte Carlo chunk of one replication sends one-element arrays', async () => {
  const design: McDesign = {
    population: {
      constructs: ['A', 'B'].map((name) => ({
        name,
        type: 'factor' as const,
        indicators: [1, 2, 3].map((i) => `${name.toLowerCase()}${i}`),
        loadings: [0.8, 0.7, 0.75],
      })),
      paths: [{ from: 'A', to: 'B', value: 0.4 }],
      exoCor: [],
    },
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [200],
    replications: 1,
    seed: 5,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 500,
  };
  const raw = await rCall<Record<string, any>>(
    'ps_mc',
    mcChunkRequest(design, 200, 0, 1),
    'simulation',
  );
  expect(Array.isArray(raw.proper[0])).toBe(true);
  expect(Array.isArray(raw.est[0][0])).toBe(true);
  const part = await runMcChunkR(design, 200, 0, 1);
  expect(part.est[0][0]).toHaveLength(1);
}, 600_000);

it('values per group go to the groups in the order of their codes, whatever the order of the rows', async () => {
  // Two groups (codes 1 and 2) and a covariance held at 0.2 in group 1 and 0.4 in group 2.
  const g = Float64Array.from(hs.cols[0], (_v, i) => (i % 3 === 1 ? 2 : 1));
  const grouped = { names: [...hs.names, 'g'], cols: [...hs.cols, g] };
  const order = Array.from(g.keys()).sort((a, b) => g[b] - g[a] || a - b);
  const reordered = {
    names: grouped.names,
    cols: grouped.cols.map((c) => Float64Array.from(order, (i) => c[i])),
  };
  const f = (name: string, indicators: string[]) => ({
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators,
  });
  const spec: ModelSpec = {
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6'])],
    paths: [],
    covariances: [{ a: 'visual', b: 'textual', kind: 'construct', byGroup: [0.2, 0.4] }],
    multigroup: { column: 'g', invariance: 'configural', free: [] },
  };
  const first = await estimateCbLavaan(grouped, spec, 'casewise', 'ML');
  const sorted = await estimateCbLavaan(reordered, spec, 'casewise', 'ML');
  // (rows of group 2 first: lavaan makes it its first group, so the values must follow the groups, not the positions)
  expect(reordered.cols[9][0]).toBe(2);
  expect(first.groups!.labels).toEqual(['1', '2']);
  expect(sorted.groups!.labels).toEqual(['2', '1']);
  expect(sorted.fit.chisq).toBeCloseTo(first.fit.chisq, 8);
  const cov = (r: typeof first, group: string) =>
    r.groups!.results[r.groups!.labels.indexOf(group)].estimates.find(
      (e) => e.op === '~~' && e.lhs === 'visual' && e.rhs === 'textual',
    )!.est;
  for (const r of [first, sorted]) {
    expect(cov(r, '1')).toBeCloseTo(0.2, 12);
    expect(cov(r, '2')).toBeCloseTo(0.4, 12);
  }
}, 600_000);

it('PLS multiple imputation reports the method it used and passes mice’s warnings on', async () => {
  // Some missing values in x1 and x5.
  const holes = {
    names: hs.names,
    cols: hs.cols.map((c, j) =>
      Float64Array.from(c, (v, i) => ((j === 0 || j === 4) && i % 17 === 3 ? NaN : v)),
    ),
  };
  const f = (name: string, indicators: string[]) => ({
    name,
    type: 'composite' as const,
    mode: 'A' as const,
    indicators,
  });
  const spec: ModelSpec = {
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6'])],
    paths: [{ from: 'visual', to: 'textual' }],
  };
  const options = (method: 'amelia' | 'micenorm') => ({
    scheme: 'path' as const,
    maxIter: 300,
    tolerance: 1e-7,
    missing: 'mi' as const,
    consistent: false,
    mi: { m: 3, seed: 7, method },
  });
  const amelia = await estimatePlsR(holes, spec, options('amelia'), 'seminr');
  expect(amelia.imputations).toBe(3);
  expect(amelia.imputationMethod).toBe('mice');
  expect(amelia.warnings.join(' ')).toMatch(
    /PLS imputes with mice .*Amelia II setting applies to CB-SEM/,
  );
  const norm = await estimatePlsR(holes, spec, options('micenorm'), 'seminr');
  expect(norm.imputationMethod).toBe('micenorm');
  expect(norm.pathCoef[0][1]).not.toBe(amelia.pathCoef[0][1]);
  const script = await plsScriptR(holes, spec, options('micenorm'), 'seminr');
  expect(script).toContain('method = "norm"');
}, 600_000);

it('a lavaan bootstrap gives the same intervals on one R session as on several (chunks with seed + k)', async () => {
  const f = (name: string, indicators: string[]) => ({
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators,
  });
  const spec: ModelSpec = {
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6'])],
    paths: [{ from: 'visual', to: 'textual' }],
  };
  const a = {
    kind: 'cbBoot' as const,
    estimator: 'ML' as const,
    missing: 'casewise' as const,
    boot: { samples: 250, seed: 11, confidence: 0.95 },
  };
  expect(bootChunked(a)).toBe(true);
  const sessions = async (n: number) => {
    await parallelism();
    const h = useHelper.getState();
    useHelper.setState({ info: { ...h.info!, workers: n } });
    return (await parallelism()).sessions;
  };
  await parallelism();
  const before = useHelper.getState().info!.workers;
  try {
    expect(await sessions(4)).toBe(4);
    const parallel = await bootstrapR(hs, spec, a, () => 'x');
    expect(await sessions(1)).toBe(1);
    const serial = await bootstrapR(hs, spec, a, () => 'x');
    expect(serial.chunked).toBe(true);
    expect(parallel.chunked).toBe(true);
    expect(serial.stats.length).toBeGreaterThan(5);
    expect(serial.stats).toEqual(parallel.stats);
    // The exported script draws the same chunks.
    const script = await analysisScript(hs, spec, a);
    expect(script).toContain('chunks <- data.frame(R = c(100, 100, 50), seed = c(11, 12, 13))');
  } finally {
    await sessions(before);
  }
}, 600_000);

it('the LMS / QML script reproduces the fit measures reported (the baseline refit without the interaction)', async () => {
  const dir = join(__dirname, '..', 'engine', '__fixtures__', 'modsem');
  const data = parseCsv(readFileSync(join(dir, 'oneInt.csv'), 'utf8')).dataset;
  const f = (name: string, p: string) => ({
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators: [1, 2, 3].map((i) => `${p}${i}`),
  });
  const spec: ModelSpec = {
    constructs: [f('X', 'x'), f('Z', 'z'), f('Y', 'y')],
    paths: [
      { from: 'X', to: 'Y' },
      { from: 'Z', to: 'Y' },
    ],
    moderations: [{ from: 'X', moderator: 'Z', to: 'Y' }],
  };
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'qml');
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML', 'qml');
  expect(script).toContain('base <- lavaan::sem(gsub(');
  const out = runScript(
    `${script}\nwriteLines(jsonlite::toJSON(as.list(fitMeasures(base, c("chisq", "cfi", "rmsea", "srmr"))), digits = NA, auto_unbox = TRUE), "out.json")`,
  );
  expect(out.chisq).toBeCloseTo(r.fit.chisq, 6);
  expect(out.cfi).toBeCloseTo(r.fit.cfi, 6);
  expect(out.rmsea).toBeCloseTo(r.fit.rmsea, 6);
  expect(out.srmr).toBeCloseTo(r.fit.srmr, 6);
}, 900_000);

/** Run an exported script in desktop R (Rscript); it writes out.json, returned parsed. */
function runScript(script: string): Record<string, number> {
  const dir = mkdtempSync(join(tmpdir(), 'ps-rbridge-'));
  try {
    writeFileSync(join(dir, 'script.R'), script);
    const libs = [helperLibrary(), process.env.R_LIBS].filter(Boolean).join(':');
    execFileSync('Rscript', ['script.R'], {
      cwd: dir,
      env: { ...process.env, R_LIBS: libs },
      stdio: 'pipe',
    });
    return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
