import { describe, expect, it } from 'vitest';
import { categoriesOf } from '../io';
import { withGroupNames, type CbResultR } from '../rengine/lavaan';
import { DEFAULT_SETTINGS, parseProject, serializeProject, validateModel, type ModelState } from './project';

const data = { names: ['a1', 'a2', 'a3', 'school'], cols: [Float64Array.of(1, 2, 3), Float64Array.of(2, 3, 1), Float64Array.of(3, 1, 2), Float64Array.of(1, 2, 2)], categories: { school: ['Grant-White', 'Pasteur'] } };
const model: ModelState = { constructs: [{ id: 'A', name: 'A', type: 'factor', mode: 'A', indicators: ['a1', 'a2', 'a3'], x: 0, y: 0, side: 'left' }], paths: [], moderations: [] };

describe('text (categorical) columns', () => {
  it('are kept in project files, and labels are validated as text', () => {
    const p = parseProject(serializeProject(model, DEFAULT_SETTINGS, data, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] }));
    expect(p.data!.categories).toEqual({ school: ['Grant-White', 'Pasteur'] });
    const text = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, data, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] }));
    // Labels of columns that do not exist are dropped; labels that are not text make the file invalid.
    text.data.categories = { school: ['a', 'b'], nothere: ['y'] };
    expect(Object.keys(parseProject(JSON.stringify(text)).data!.categories!)).toEqual(['school']);
    text.data.categories = { school: [{ evil: 1 }, 'x'] };
    expect(() => parseProject(JSON.stringify(text))).toThrow(/Invalid project file/);
  });
  it('warn when used as indicators', () => {
    const m: ModelState = { ...model, constructs: [{ ...model.constructs[0], indicators: ['a1', 'a2', 'school'] }] };
    const w = validateModel(m, data, { ...DEFAULT_SETTINGS, method: 'cbsem' }).filter((i) => i.level === 'warning').map((i) => i.message);
    expect(w.some((x) => /school is a text column, used through its codes 1, 2, … in alphabetical order \(Grant-White, Pasteur\)/.test(x))).toBe(true);
  });
  it('give group results their names', () => {
    const r = { groups: { labels: ['1 · Within', '1 · Between', '2 · Within', '2 · Between'], results: [], score: [{ param: 'x', groups: ['1', '2'], x2: 1, df: 1, p: 0.3 }] }, modindices: [{ lhs: 'A', op: '=~', rhs: 'a1', mi: 4, epc: 0, sepc: 0, group: '2' }] } as unknown as CbResultR;
    const n = withGroupNames(r, ['Grant-White', 'Pasteur']);
    expect(n.groups!.labels).toEqual(['Grant-White · Within', 'Grant-White · Between', 'Pasteur · Within', 'Pasteur · Between']);
    expect(n.groups!.score[0].groups).toEqual(['Grant-White', 'Pasteur']);
    expect(n.modindices![0].group).toBe('Pasteur');
    expect(withGroupNames({ ...r, groups: { ...r.groups!, labels: ['3'] } }, ['a']).groups!.labels).toEqual(['3']);
  });
  it('R factor levels become categories', () => {
    expect(categoriesOf({ school: ['Grant-White', 'Pasteur'], one: 'only' })).toEqual({ categories: { school: ['Grant-White', 'Pasteur'], one: ['only'] } });
    expect(categoriesOf([])).toEqual({});
    expect(categoriesOf(undefined)).toEqual({});
  });
});
