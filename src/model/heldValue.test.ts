import { describe, expect, it } from 'vitest';
import { heldText, parseHeldValue } from './heldValue';

describe('held and labelled parameter values typed in the dialogs', () => {
  it('reads free, a value, a label and values per group', () => {
    expect(parseHeldValue('', { groups: false })).toBeNull();
    expect(parseHeldValue('  NA ', { groups: false })).toBeNull();
    expect(parseHeldValue('1', { groups: false })).toEqual({ fixed: 1 });
    expect(parseHeldValue('-0.5e1', { groups: false })).toEqual({ fixed: -5 });
    expect(parseHeldValue('ve1', { groups: false })).toEqual({ label: 've1' });
    expect(parseHeldValue('1, NA, a', { groups: true })).toEqual({ byGroup: [1, null, 'a'] });
    expect(parseHeldValue('c(1, *, b2)', { groups: true })).toEqual({ byGroup: [1, null, 'b2'] });
  });

  it('refuses what lavaan could not take', () => {
    expect(parseHeldValue('1, 2', { groups: false })).toHaveProperty('error');
    expect(parseHeldValue('1 + 2', { groups: false })).toHaveProperty('error');
    expect(parseHeldValue('a; system("x")', { groups: false })).toHaveProperty('error');
    expect(parseHeldValue('1, "a"', { groups: true })).toHaveProperty('error');
    expect(parseHeldValue('1e9', { groups: false })).toHaveProperty('error');
    expect(parseHeldValue('y1', { groups: false, reserved: new Set(['y1']) })).toHaveProperty('error');
    expect(parseHeldValue('1, y1', { groups: true, reserved: new Set(['y1']) })).toHaveProperty('error');
  });

  it('writes the current state back as the dialog shows it', () => {
    expect(heldText(undefined)).toBe('');
    expect(heldText({ fixed: 1 })).toBe('1');
    expect(heldText({ label: 'a' })).toBe('a');
    expect(heldText({ byGroup: [1, null, 'a'] })).toBe('1, NA, a');
    for (const t of ['2', 'lab', '1, NA, a']) expect(heldText(parseHeldValue(t, { groups: true }) as never)).toBe(t);
  });
});

describe('values per group in the model check', () => {
  it('need groups, and one entry per group', async () => {
    const { DEFAULT_SETTINGS, validateModel } = await import('./project');
    const { parseLavaanSyntax } = await import('./syntax');
    const { model } = parseLavaanSyntax('f =~ y1 + y2 + y3');
    const f = model.constructs[0].id;
    const data = { names: ['y1', 'y2', 'y3', 'g'], cols: [0, 1, 2].map(() => Float64Array.from({ length: 80 }, (_, i) => Math.sin(i))).concat([Float64Array.from({ length: 80 }, (_, i) => (i < 40 ? 1 : 2))]) };
    const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, engine: 'r' as const };
    const errors = (m: typeof model) => validateModel(m, data, settings).filter((i) => i.level === 'error').map((i) => i.message);
    const perGroup = { ...model, parameters: [{ id: 'v', kind: 'variance' as const, target: f, byGroup: [1, null, 2] }] };
    expect(errors(perGroup)).toEqual([expect.stringMatching(/no groups/)]);
    const grouped = { ...perGroup, multigroup: { column: 'g', invariance: 'configural' as const, free: [] } };
    expect(errors(grouped)).toEqual([expect.stringMatching(/one entry for each of the 2 groups/)]);
    expect(errors({ ...grouped, parameters: [{ id: 'v', kind: 'variance' as const, target: f, byGroup: [1, null] }] })).toEqual([]);
  });
});
