// A replication package built through webR (an HS CB-SEM model with its
// bootstrap, an NCA card and a closed-form card), unzipped and run with native
// R: run-all.R must reproduce without errors. Run with npm run test:webr.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { addAnalysis, loadCards } from '../analyses/store';
import { rCall } from '../rengine/bridge';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { useStore } from '../store';
import { buildPackage, packageItems } from './package';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('builds a package whose run-all.R runs in native R', async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  const s = useStore.getState();
  s.newProject();
  s.setProjectName('HS replication');
  s.setData({ names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) }, { fileName: 'hs.csv', rows: raw.cols[0].length, missingCells: 0, excluded: [] });
  const K = (name: string, ind: string[]) => ({ id: name, name, type: 'factor' as const, mode: 'A' as const, indicators: ind, x: 0, y: 0, side: 'left' as const });
  useStore.setState({ model: { constructs: [K('visual', ['x1', 'x2', 'x3']), K('textual', ['x4', 'x5', 'x6'])], paths: [{ id: 'p', from: 'visual', to: 'textual' }], moderations: [] } });
  s.setSettings({ method: 'cbsem', engine: 'r', estimator: 'ML', missing: 'casewise', bootSamples: 20, seed: 1 });
  loadCards([]);
  addAnalysis('nca', { x: ['x1'], y: 'x4', permutations: 20 });
  const items = packageItems();
  expect(items.map((i) => i.kind)).toEqual(['model', 'bootstrap', 'card']);
  const p = await buildPackage(new Set(items.map((i) => i.id)), { data: true, report: false });
  expect(p.scripts).toBe(3);
  const dir = mkdtempSync(join(tmpdir(), 'replication-'));
  writeFileSync(join(dir, p.name), Buffer.from(await p.zip.arrayBuffer()));
  execFileSync('unzip', ['-q', join(dir, p.name), '-d', dir]);
  const root = join(dir, p.name.replace(/\.zip$/, ''));
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('| lavaan | 0.');
  expect(readme).toContain('R version');
  expect(existsSync(join(root, 'data', 'hs.csv'))).toBe(true);
  expect(readFileSync(join(root, 'data', 'hs.csv'), 'utf8').split('\n')[0]).toContain('x1');
  expect(existsSync(join(root, 'project', 'project.plsproj.json'))).toBe(true);
  // Native R (the user's system library; nothing is installed).
  const run = spawnSync('Rscript', ['run-all.R'], { cwd: join(root, 'R'), encoding: 'utf8', timeout: 600_000 });
  expect(run.status, run.stderr.slice(-2000)).toBe(0);
  expect(run.stderr).toContain('== 01-model.R');
  expect(run.stderr).toContain('== 03-necessary-condition-analysis.R');
  expect(run.stdout).toContain('Root Mean Square Error of Approximation');
}, 900_000);

it('shares the covariance matrix instead of the raw data: the model refits from it in native R, the rest is listed as needing cases', async () => {
  const items = packageItems();
  const p = await buildPackage(new Set(items.map((i) => i.id)), { data: 'covariance', report: false });
  expect(p.scripts).toBe(1);
  const dir = mkdtempSync(join(tmpdir(), 'replication-cov-'));
  writeFileSync(join(dir, p.name), Buffer.from(await p.zip.arrayBuffer()));
  execFileSync('unzip', ['-q', join(dir, p.name), '-d', dir]);
  const root = join(dir, p.name.replace(/\.zip$/, ''));
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  expect(readme).toContain('the raw data are not shared');
  expect(readme).toContain('Not included, because they need the raw data');
  expect(existsSync(join(root, 'data', 'hs-covariances.csv'))).toBe(true);
  const csv = readFileSync(join(root, 'data', 'hs-covariances.csv'), 'utf8');
  expect(csv.split('\n')[0]).toBe(',x1,x2,x3,x4,x5,x6');
  expect(csv.split('\n')[1]).toMatch(/^mean,/);  // the means travel with the matrix (a mean structure can be refitted)
  expect(csv.split('\n').length).toBe(9);
  const script = readFileSync(join(root, 'R', '01-model.R'), 'utf8');
  expect(script).toContain('sample.cov = S, sample.nobs = N');
  expect(script).not.toMatch(/data <- read\.csv/);
  const project = JSON.parse(readFileSync(join(root, 'project', 'project.plsproj.json'), 'utf8'));
  expect(project.data.columns).toEqual([]);
  expect(project.data.moments.n).toBe(301);
  const run = spawnSync('Rscript', ['run-all.R'], { cwd: join(root, 'R'), encoding: 'utf8', timeout: 600_000 });
  expect(run.status, run.stderr.slice(-2000)).toBe(0);
  expect(run.stdout).toContain('Number of observations');
  expect(run.stdout).toContain('301');
}, 900_000);
