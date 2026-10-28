import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateModel } from '../model/project';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

describe.each(PACKAGE_EXAMPLES.map((e) => [e.id, e] as const))('package example %s', (_id, ex) => {
  it('builds a valid model for its method', () => {
    const model = exampleModel(ex);
    const names = model.constructs.flatMap((c) => c.indicators);
    const data = { names, cols: names.map((_, k) => Float64Array.from({ length: 400 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 3)))) };
    const errors = validateModel(model, data, { ...DEFAULT_SETTINGS, ...ex.settings }).filter((i) => i.level === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
    expect(model.moderations.length).toBe(ex.moderations?.length ?? 0);
    expect(model.correlations?.length ?? 0).toBe(ex.correlations?.length ?? 0);
  });
});

it('ids are unique and every package is represented', () => {
  expect(new Set(PACKAGE_EXAMPLES.map((e) => e.id)).size).toBe(PACKAGE_EXAMPLES.length);
  expect(new Set(PACKAGE_EXAMPLES.map((e) => e.package))).toEqual(new Set(['lavaan', 'MIIVsem', 'cSEM', 'seminr']));
});

it('every example links to its original documentation (https)', () => {
  for (const e of PACKAGE_EXAMPLES) {
    expect(e.links.length, e.id).toBeGreaterThan(0);
    for (const l of e.links) expect(l.url, `${e.id}: ${l.label}`).toMatch(/^https:\/\//);
  }
});
