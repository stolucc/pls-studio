// The browser side against the real GPU worker (helper/gpusrc/worker.py in its development venv): the worker's
// answer read as a RangePart and merged like the browser engine's own draws. Skipped without the venv.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeBootstrap, runRange } from '../engine/bootstrap';
import { parseCsv } from '../engine/dataset';
import { DEFAULT_OPTIONS, type ModelSpec } from '../engine/types';
import { gpuBootstrap, gpuPlan, type GpuRequest } from './gpu';

const root = join(__dirname, '..', '..');
const python = join(root, 'helper', 'gpusrc', '.venv', 'bin', 'python');
const MARK = '\x1ePSH\x1e';

/** One request to a fresh worker process (CPU, so the draws are double precision). */
function askWorker(req: GpuRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const p = spawn(python, ['-I', join(root, 'helper', 'gpusrc', 'worker.py'), 'cpu']);
    let out = '';
    p.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      // (only complete lines: a reply arrives in several chunks)
      const lines = out
        .split('\n')
        .slice(0, -1)
        .filter((l) => l.startsWith(MARK));
      if (lines.length < 2) return;
      p.kill();
      const rep = JSON.parse(lines[1].slice(MARK.length)) as {
        ok: boolean;
        result?: Record<string, unknown>;
        message?: string;
      };
      if (rep.ok && rep.result) resolve(rep.result);
      else reject(new Error(rep.message));
    });
    p.on('error', reject);
    p.stdin.write(JSON.stringify({ id: 't', op: 'bootstrap', req }) + '\n');
  });
}

describe.skipIf(!existsSync(python))('the real GPU worker', () => {
  const data = parseCsv(
    readFileSync(join(root, 'src/engine/__fixtures__/mobi.csv'), 'utf8'),
  ).dataset;
  const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
  const spec: ModelSpec = {
    constructs: [
      { name: 'Image', mode: 'A', indicators: items('IMAG', 5) },
      { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) },
      { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) },
    ],
    paths: [
      { from: 'Image', to: 'Satisfaction' },
      { from: 'Satisfaction', to: 'Loyalty' },
      { from: 'Image', to: 'Loyalty' },
    ],
  };
  it('answers with the browser engine’s draws, which merge to the same intervals', async () => {
    const boot = { samples: 40, seed: 5, interval: 'bca' as const, inadmissible: 'drop' as const };
    const plan = gpuPlan(data, spec, DEFAULT_OPTIONS, boot, 2, 'double');
    const { parts, precision } = await gpuBootstrap(plan, undefined, askWorker);
    expect(precision).toBe('float64');
    expect(parts[0].jack).toBeDefined();
    expect(parts[1].jack).toBeUndefined();
    const native = runRange({
      job: 'pls',
      data,
      spec,
      options: DEFAULT_OPTIONS,
      seed: 5,
      start: 0,
      end: 40,
      jackknife: true,
    });
    const a = mergeBootstrap(parts, 0.95);
    const b = mergeBootstrap([native], 0.95);
    expect(a.interval).toBe('bca');
    expect(a.stats.map((s) => s.key)).toEqual(b.stats.map((s) => s.key));
    a.stats.forEach((s, i) => {
      expect(s.original).toBeCloseTo(b.stats[i].original, 10);
      expect(s.ciLow).toBeCloseTo(b.stats[i].ciLow, 10);
      expect(s.ciHigh).toBeCloseTo(b.stats[i].ciHigh, 10);
    });
  }, 60_000);
});
