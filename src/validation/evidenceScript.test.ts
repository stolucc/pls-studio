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

/** Runs the script on a previous record and this run's checks (and the other run's directory); the new record. */
function mergeRecord(previous: object[], run: object[], opts: { desktopRun?: object[] } = {}) {
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
  if (opts.desktopRun) {
    mkdirSync(join(dir, '.validation-desktop'));
    writeFileSync(join(dir, '.validation-desktop', 'run.json'), JSON.stringify(opts.desktopRun));
  }
  const r = spawnSync(process.execPath, [SCRIPT, '.validation'], { cwd: dir, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return {
    record: JSON.parse(readFileSync(join(dir, 'public', 'validation.json'), 'utf8')) as {
      checks: {
        id: string;
        runtime?: string;
        test: string;
        comparisons: { quantity: string; runtime?: string }[];
      }[];
    },
    out: r.stdout,
  };
}

/** The new record's check ids. */
function merge(previous: object[], run: object[]): { ids: string[]; out: string } {
  const { record, out } = mergeRecord(previous, run);
  return { ids: record.checks.map((c) => c.id).sort(), out };
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

describe('an example checked in webR and in desktop R', () => {
  const cmp = (quantity: string) => ({ quantity, value: 1, reference: 1, tolerance: 0.1 });
  const webr = check('kock', {
    subject: 'example',
    test: 'examples/packages: kock',
    comparisons: [cmp('unexpected R warnings')],
  });
  const desktopCheck = check('kock', {
    subject: 'example',
    runtime: 'desktop',
    test: 'examples/cards/model.kockHadaya100: kock at N = 100',
    comparisons: [cmp('PLS power at N = 100')],
  });

  it('is one check with both runs’ comparisons, the desktop ones marked', () => {
    const { record } = mergeRecord([], [webr], { desktopRun: [desktopCheck] });
    expect(record.checks).toHaveLength(1);
    const [c] = record.checks;
    expect(c.runtime).toBeUndefined();
    expect(c.comparisons.map((x) => [x.quantity, x.runtime])).toEqual([
      ['unexpected R warnings', undefined],
      ['PLS power at N = 100', 'desktop'],
    ]);
    expect(c.test).toContain('model.kockHadaya100');
  });

  it('a desktop run reads the webR records too, so neither run drops the other’s comparisons', () => {
    // (the desktop run: .validation-desktop is its directory, .validation the other run's)
    dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    for (const d of ['public', 'scripts/webr', '.validation', '.validation-desktop'])
      mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'webr', 'webr-lock.json'), JSON.stringify({ packages: {} }));
    writeFileSync(join(dir, 'public', 'validation.json'), JSON.stringify({ checks: [] }));
    writeFileSync(join(dir, '.validation', 'run.json'), JSON.stringify([webr]));
    writeFileSync(join(dir, '.validation-desktop', 'run.json'), JSON.stringify([desktopCheck]));
    const r = spawnSync(process.execPath, [SCRIPT, '.validation-desktop', '--desktop'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const { checks } = JSON.parse(readFileSync(join(dir, 'public', 'validation.json'), 'utf8'));
    expect(checks).toHaveLength(1);
    expect(checks[0].comparisons).toHaveLength(2);
    expect(checks[0].comparisons[1].runtime).toBe('desktop');
  });

  it('without the other run’s directory keeps its checks from the record, as before', () => {
    const { record } = mergeRecord([desktopCheck], [check('rengine/pls::t')]);
    expect(record.checks.map((c) => [c.id, c.runtime])).toEqual(
      expect.arrayContaining([['kock', 'desktop']]),
    );
  });
});
