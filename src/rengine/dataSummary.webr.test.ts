// The data summary for secondary analysis (File menu): the package's statistics refit the model.
// Each package is written to a temporary folder and its refit.R run in desktop R (Rscript): the
// refit from the statistics alone must reproduce the estimates from the raw data (continuous: ML
// from covariances and means, also with groups; ordinal: WLSMV from polychorics, thresholds,
// NACOV and the weight matrix). Run with PS_NATIVE_R=1 (desktop R) or npm run test:webr.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { Dataset, ModelSpec } from '../engine/types';
import { dataSummaryFiles } from '../replication/dataSummary';
import type { ZipEntry } from '../replication/zip';
import { near, same } from '../validation/record';
import { rCall } from './bridge';
import { dataSummaryR, dataSummaryScriptR, type CbCall, type DataSummaryResult } from './cbExtras';
import { helperLibrary } from './nativeR';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const HS: ModelSpec = {
  constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])],
  paths: [{ from: 'visual', to: 'speed' }, { from: 'textual', to: 'speed' }],
};
const items = Array.from({ length: 9 }, (_, i) => `x${i + 1}`);

async function holzinger(): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => v ?? NaN)) };
}

interface Refit { est: number[]; se: (number | null)[]; chisq: number; df: number; lhs: string[]; op: string[]; rhs: string[]; group: number[] }

/** Write the package, run its refit.R in desktop R, and read the refit's estimates back. */
function refit(files: ZipEntry[]): Refit {
  const dir = mkdtempSync(join(tmpdir(), 'ps-data-summary-'));
  try {
    for (const file of files) writeFileSync(join(dir, file.path), file.data);
    const tail = [
      'source("refit.R")',
      'pe <- parameterEstimates(fit, ci = FALSE)',
      'if (is.null(pe$group)) pe$group <- 1',
      'fm <- fitMeasures(fit, c("chisq", "df"))',
      'out <- list(lhs = pe$lhs, op = pe$op, rhs = pe$rhs, group = pe$group, est = pe$est, se = pe$se,',
      '  chisq = unname(fm[["chisq"]]), df = unname(fm[["df"]]))',
      'writeLines(jsonlite::toJSON(out, digits = NA, auto_unbox = TRUE, na = "null"), "refit.json")',
    ].join('\n');
    writeFileSync(join(dir, 'check.R'), tail);
    const libs = [helperLibrary(), process.env.R_LIBS].filter(Boolean).join(':');
    execFileSync('Rscript', ['check.R'], { cwd: dir, env: { ...process.env, R_LIBS: libs }, stdio: 'pipe' });
    return JSON.parse(readFileSync(join(dir, 'refit.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every raw-data estimate (and, where stated, standard error) equals the refit's. */
function compare(label: string, r: DataSummaryResult, back: Refit, ses: boolean) {
  const key = (lhs: string, op: string, rhs: string, g: number) => `${lhs} ${op} ${rhs} ${g}`;
  const at = new Map(back.lhs.map((l, i) => [key(l, back.op[i], back.rhs[i], back.group[i]), i]));
  const e = r.estimates;
  e.lhs.forEach((l, i) => {
    const name = key(l, e.op[i], e.rhs[i], e.group[i]);
    const j = at.get(name);
    expect(j, `${label}: ${name} in the refit`).toBeDefined();
    // (the refit runs in desktop R; the raw-data fit in webR or desktop R: ~1e-6 from WebAssembly)
    near(`${label}: ${name}`, back.est[j!], e.est[i], 1e-5);
    const se = e.se[i];
    if (ses && se !== null) near(`${label}: SE ${name}`, back.se[j!] ?? NaN, se, 1e-5);
  });
  near(`${label}: χ²`, back.chisq, r.chisq, 1e-4);
  same(`${label}: df`, back.df, r.df);
}

describe('data summary for secondary analysis', () => {
  it('continuous indicators: ML from covariances and means reproduces the raw-data fit', async () => {
    const data = await holzinger();
    const call: CbCall = { data, spec: HS, missing: 'casewise', estimator: 'ML', interaction: 'product' };
    const r = await dataSummaryR(call);
    same('groups', r.groups.length, 1);
    same('N', r.groups[0].n, 301);
    const files = dataSummaryFiles(r, 'Holzinger');
    same('files', files.map((x) => x.path).join(' '),
      'groups.csv descriptives.csv correlations.csv covariances.csv means.csv model.lav estimates.csv refit.R README.txt');
    // The descriptives are those of the data (SD with n − 1).
    const x1 = Array.from(data.cols[data.names.indexOf('x1')]);
    const mean = x1.reduce((a, b) => a + b, 0) / x1.length;
    const sd = Math.sqrt(x1.reduce((a, b) => a + (b - mean) ** 2, 0) / (x1.length - 1));
    near('mean x1', r.groups[0].mean[0], mean, 1e-10);
    near('SD x1', r.groups[0].sd[0], sd, 1e-10);
    near('covariance x1 x1 (n − 1)', r.groups[0].cov![0][0], sd * sd, 1e-10);
    compare('HS ML', r, refit(files), true);
    // No case-level data: no file has a row per case.
    for (const file of files) expect(String(file.data).split('\n').length, file.path).toBeLessThan(100);
    expect(await dataSummaryScriptR(call)).toContain('nacov <- if (length(ordinal))');
  }, 900_000);

  it('groups: lists of statistics, one per group, reproduce a multiple-group fit', async () => {
    const data = await holzinger();
    const spec: ModelSpec = { ...HS, multigroup: { column: 'school', invariance: 'metric', free: [] } };
    const call: CbCall = { data, spec, missing: 'casewise', estimator: 'MLR', interaction: 'product' };
    const r = await dataSummaryR(call);
    same('groups', r.groups.length, 2);
    same('refit estimator (robust ML needs the raw data)', r.refitEstimator, 'ML');
    const files = dataSummaryFiles(r, 'Holzinger by school');
    expect(files.map((x) => x.path)).toContain('covariances-group2.csv');
    expect(String(files.find((x) => x.path === 'README.txt')!.data)).toContain('robust standard errors');
    // MLR's point estimates and ML χ² are ML's; the refit's standard errors are ML's, so only estimates.
    compare('HS by school', r, refit(files), false);
  }, 900_000);

  it('ordinal indicators: WLSMV from polychorics, thresholds, NACOV and weights reproduces the fit', async () => {
    const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'categorical');
    const data = parseCsv(readFileSync(join(DIR, 'hs_ordinal.csv'), 'utf8')).dataset;
    const spec: ModelSpec = { ...HS, ordered: items };
    const call: CbCall = { data, spec, missing: 'casewise', estimator: 'WLSMV', interaction: 'product' };
    const r = await dataSummaryR(call);
    const g = r.groups[0];
    expect(g.ordinal.every(Boolean)).toBe(true);
    expect(g.thresholds!.variable.length).toBeGreaterThan(9);
    same('NACOV size', g.nacov!.length, g.thresholds!.value.length + (9 * 8) / 2);
    const files = dataSummaryFiles(r, 'Ordinal');
    for (const name of ['thresholds.csv', 'nacov.csv', 'wls_v.csv', 'correlations.csv']) {
      expect(files.map((x) => x.path)).toContain(name);
    }
    expect(files.map((x) => x.path)).not.toContain('covariances.csv');
    compare('HS ordinal WLSMV', r, refit(files), true);
  }, 900_000);
});
