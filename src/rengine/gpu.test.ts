import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeBootstrap, runRange } from '../engine/bootstrap';
import { parseCsv } from '../engine/dataset';
import { DEFAULT_OPTIONS, type ModelSpec } from '../engine/types';
import type { GpuStatus } from './helper';
import {
  ableAccelerators,
  gpuBootstrap,
  gpuEngineTag,
  gpuModel,
  gpuPart,
  gpuPlan,
  gpuUnavailable,
  type GpuRequest,
} from './gpu';

const data = parseCsv(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mobi.csv'), 'utf8'),
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
const settings = { method: 'pls', engine: 'builtin', missing: 'mean' } as const;
const mps: GpuStatus = {
  accelerators: [
    {
      where: 'local',
      device: 'mps',
      name: 'Apple GPU (Metal)',
      torch: '2.15',
      precisions: ['float32'],
    },
  ],
};
const cuda: GpuStatus = {
  accelerators: [
    {
      where: 'node1',
      device: 'cuda',
      name: 'GTX 1080',
      torch: '2.7',
      precisions: ['float32', 'float64'],
    },
    {
      where: 'node2',
      device: 'cuda',
      name: 'GTX 1080',
      torch: '2.7',
      precisions: ['float32', 'float64'],
    },
  ],
};
const ready = { state: 'ready' as const, gpu: mps };

describe('gpuUnavailable', () => {
  it('allows a plain PLS bootstrap on a connected helper with a worker', () => {
    expect(gpuUnavailable(spec, settings, 'boot', ready, 'auto')).toBeNull();
    expect(gpuUnavailable(spec, settings, 'boot', ready, 'single')).toBeNull();
  });
  it('names what keeps a bootstrap in the browser', () => {
    expect(gpuUnavailable(spec, settings, 'fittest', ready, 'auto')).toMatch(/only bootstrapping/);
    expect(gpuUnavailable(spec, settings, 'estimate', ready, 'auto')).toMatch(/only bootstrapping/);
    expect(gpuUnavailable(spec, { ...settings, method: 'cbsem' }, 'boot', ready, 'auto')).toMatch(
      /PLS/,
    );
    expect(gpuUnavailable(spec, { ...settings, engine: 'r' }, 'boot', ready, 'auto')).toMatch(
      /built-in/,
    );
    expect(gpuUnavailable(spec, { ...settings, missing: 'fiml' }, 'boot', ready, 'auto')).toMatch(
      /missing/,
    );
    expect(gpuUnavailable(spec, { ...settings, missing: 'mi' }, 'boot', ready, 'auto')).toMatch(
      /missing/,
    );
    const mod = {
      ...spec,
      moderations: [{ from: 'Image', moderator: 'Satisfaction', to: 'Loyalty' }],
    };
    expect(gpuUnavailable(mod, settings, 'boot', ready, 'auto')).toMatch(/interaction/);
    expect(
      gpuUnavailable(
        { ...spec, copulas: [{ from: 'Image', to: 'Loyalty' }] },
        settings,
        'boot',
        ready,
        'auto',
      ),
    ).toMatch(/copula/);
    expect(gpuUnavailable({ ...spec, weights: 'w' }, settings, 'boot', ready, 'auto')).toMatch(
      /weights/,
    );
    expect(
      gpuUnavailable({ ...spec, ordered: ['IMAG1'] }, settings, 'boot', ready, 'auto'),
    ).toMatch(/ordinal/);
  });
  it('needs the helper, a worker and an accelerator of the precision', () => {
    expect(gpuUnavailable(spec, settings, 'boot', { state: 'absent' }, 'auto')).toMatch(
      /not connected/,
    );
    expect(gpuUnavailable(spec, settings, 'boot', { state: 'ready' }, 'auto')).toMatch(/too old/);
    expect(
      gpuUnavailable(
        spec,
        settings,
        'boot',
        { state: 'ready', gpu: { accelerators: [], starting: true } },
        'auto',
      ),
    ).toMatch(/starting/);
    expect(
      gpuUnavailable(
        spec,
        settings,
        'boot',
        { state: 'ready', gpu: { accelerators: [], error: 'not set up' } },
        'auto',
      ),
    ).toMatch(/not set up/);
    expect(gpuUnavailable(spec, settings, 'boot', ready, 'double')).toMatch(/double precision/);
    expect(
      gpuUnavailable(spec, settings, 'boot', { state: 'ready', gpu: cuda }, 'double'),
    ).toBeNull();
  });
  it('lists the accelerators able to compute in a precision', () => {
    expect(ableAccelerators(mps, 'double')).toEqual([]);
    expect(ableAccelerators(mps, 'single')).toHaveLength(1);
    expect(ableAccelerators(cuda, 'double')).toHaveLength(2);
    expect(ableAccelerators(undefined, 'auto')).toEqual([]);
  });
});

describe('gpuPlan', () => {
  it('prepares the columns and compiled model the worker needs, one range per accelerator', () => {
    const { model, cols } = gpuModel(data, spec, DEFAULT_OPTIONS);
    expect(model.indicatorNames).toEqual([
      ...items('IMAG', 5),
      ...items('CUSA', 3),
      ...items('CUSL', 3),
    ]);
    expect(cols).toHaveLength(11);
    expect(cols[0]).toHaveLength(250);
    const plan = gpuPlan(
      data,
      spec,
      DEFAULT_OPTIONS,
      { samples: 1000, seed: 7, interval: 'bca', inadmissible: 'keep' },
      2,
      'single',
    );
    expect(plan.ranges).toEqual([
      [0, 500],
      [500, 1000],
    ]);
    const first = plan.request(0, 500, true);
    const second = plan.request(500, 1000, false);
    expect(first).toMatchObject({
      seed: 7,
      precision: 'single',
      keepInadmissible: true,
      jackknife: true,
      start: 0,
      end: 500,
    });
    expect(first.options).toEqual({
      scheme: 'path',
      maxIter: 300,
      tolerance: 1e-7,
      consistent: false,
      absRhoA: true,
    });
    expect(second.jackknife).toBeUndefined();
    expect(second.innerSamples).toBeUndefined();
    const stud = gpuPlan(
      data,
      spec,
      DEFAULT_OPTIONS,
      { samples: 10, seed: 1, interval: 'studentized', inadmissible: 'drop' },
      1,
      'auto',
    );
    expect(stud.request(0, 10, true)).toMatchObject({ innerSamples: 50 });
    expect(stud.request(0, 10, true).keepInadmissible).toBeUndefined();
    expect(stud.request(0, 10, true).options.absRhoA).toBeUndefined();
  });
});

describe('gpuPart and gpuBootstrap', () => {
  it('reads the worker’s answer as a RangePart, null as NaN', () => {
    const part = gpuPart({
      start: 3,
      params: [{ key: 'path:A:B', group: 'path', label: 'A → B' }],
      originals: [0.5],
      draws: [[0.4, null, 0.6]],
      jack: [[0.5, 0.51]],
      precision: 'float32',
    });
    expect(part.start).toBe(3);
    expect(part.params).toEqual([{ key: 'path:A:B', group: 'path', label: 'A → B' }]);
    expect(Array.from(part.draws[0])).toEqual([0.4, NaN, 0.6]);
    expect(Array.from(part.jack![0])).toEqual([0.5, 0.51]);
    expect(part.precision).toBe('float32');
    expect(() => gpuPart({ params: [], draws: [] })).toThrow(/without the bootstrap draws/);
    expect(() => gpuPart({ params: [{ key: 'a' }], draws: [] })).toThrow();
  });
  it('merges the ranges exactly as the browser engine does when the worker answers with its draws', async () => {
    // A stand-in worker: the native engine itself, answering through JSON (as the real one does).
    const post = async (req: GpuRequest) => {
      const part = runRange({
        job: 'pls',
        data,
        spec,
        options: DEFAULT_OPTIONS,
        seed: req.seed,
        start: req.start,
        end: req.end,
      });
      return JSON.parse(
        JSON.stringify({
          ...part,
          draws: part.draws.map((d) => Array.from(d)),
          precision: 'float64',
        }),
      ) as Record<string, unknown>;
    };
    const plan = gpuPlan(
      data,
      spec,
      DEFAULT_OPTIONS,
      { samples: 60, seed: 3, interval: 'percentile', inadmissible: 'drop' },
      3,
      'double',
    );
    const seen: number[] = [];
    const { parts, precision } = await gpuBootstrap(plan, (f) => seen.push(f), post);
    expect(precision).toBe('float64');
    expect(seen).toEqual([1, 2, 3]);
    const whole = runRange({
      job: 'pls',
      data,
      spec,
      options: DEFAULT_OPTIONS,
      seed: 3,
      start: 0,
      end: 60,
    });
    const a = mergeBootstrap(parts, 0.95);
    const b = mergeBootstrap([whole], 0.95);
    expect(a.samples).toBe(60);
    a.stats.forEach((s, i) => {
      expect(s.key).toBe(b.stats[i].key);
      expect(s.ciLow).toBeCloseTo(b.stats[i].ciLow, 12);
      expect(s.ciHigh).toBeCloseTo(b.stats[i].ciHigh, 12);
    });
  });
  it('names the engine with the device and precision', () => {
    expect(gpuEngineTag(mps.accelerators[0], 'float32')).toEqual({
      package: 'the GPU engine',
      version: '(Apple GPU (Metal), single precision)',
    });
    expect(gpuEngineTag(undefined, 'float64').version).toBe('(accelerator, double precision)');
  });
});
