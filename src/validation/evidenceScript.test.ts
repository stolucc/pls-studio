// scripts/validation/evidence.mjs, run on a scratch directory: what a webR run keeps from public/validation.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'validation', 'evidence.mjs');

const check = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  subject: 'feature',
  title: id,
  method: 'PLS-SEM',
  level: 'published',
  sources: [],
  packages: ['seminr'],
  passed: true,
  test: id,
  comparisons: [],
  ...over,
});

let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/** Runs the script on a previous record and this run's checks; the new record's check ids. */
function merge(previous: object[], run: object[]): { ids: string[]; out: string } {
  dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  mkdirSync(join(dir, 'public'));
  mkdirSync(join(dir, 'scripts', 'webr'), { recursive: true });
  mkdirSync(join(dir, '.validation'));
  writeFileSync(join(dir, 'scripts', 'webr', 'webr-lock.json'), JSON.stringify({ packages: {} }));
  writeFileSync(
    join(dir, 'public', 'validation.json'),
    JSON.stringify({ generated: '2026-01-01', checks: previous }),
  );
  writeFileSync(join(dir, '.validation', 'run.json'), JSON.stringify(run));
  const r = spawnSync(process.execPath, [SCRIPT, '.validation'], { cwd: dir, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  const record = JSON.parse(readFileSync(join(dir, 'public', 'validation.json'), 'utf8'));
  return { ids: record.checks.map((c: { id: string }) => c.id).sort(), out: r.stdout };
}

describe('the evidence merge', () => {
  const barcomb = check('rengine/barcomb::the global model');
  const old = check('rengine/pls::old test');

  it('keeps the checks of a private-data test the run did not have the data for', () => {
    const { ids, out } = merge([barcomb, old], [check('rengine/pls::new test')]);
    expect(ids).toEqual(['rengine/barcomb::the global model', 'rengine/pls::new test']);
    expect(out).toContain('BARCOMB_DATA');
  });

  it('replaces them when the run recorded the test', () => {
    const { ids } = merge([barcomb, old], [check('rengine/barcomb::REBUS-PLS')]);
    expect(ids).toEqual(['rengine/barcomb::REBUS-PLS']);
  });
});
