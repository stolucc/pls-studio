import { beforeEach, describe, expect, it } from 'vitest';
import { switchMethod } from './methodSwitch';
import { DEFAULT_SETTINGS, type ModelState } from './model/project';
import { useStore } from './store';

const C = (id: string, type: 'factor' | 'composite', extra = {}) => ({ id, name: id, type, mode: type === 'composite' ? 'B' as const : 'A' as const, indicators: [`${id}1`], x: 0, y: 0, side: 'left' as const, ...extra });
const model: ModelState = { constructs: [C('A', 'composite'), C('B', 'factor')], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
const s = () => useStore.getState();
const yes = () => Promise.resolve(true), no = () => Promise.resolve(false);

describe('switchMethod', () => {
  beforeEach(() => useStore.setState({ model, settings: { ...DEFAULT_SETTINGS, method: 'pls' }, data: null, past: [], future: [], toasts: [] }));

  it('converts composites to common factors when switching to CB-SEM, undoably', async () => {
    expect(await switchMethod('cbsem', yes)).toBe(true);
    expect(s().settings.method).toBe('cbsem');
    expect(s().model.constructs[0]).toMatchObject({ type: 'factor', mode: 'A' });
    s().undo();
    expect(s().model.constructs[0].type).toBe('composite');
  });

  it('stays in PLS when the conversion is declined', async () => {
    expect(await switchMethod('cbsem', no)).toBe(false);
    expect(s().settings.method).toBe('pls');
    expect(s().model.constructs[0].type).toBe('composite');
  });

  it('refuses PLS for covariance-matrix data and higher-order constructs', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, method: 'cbsem' }, data: { names: ['A1'], cols: [], moments: { S: [[1]], n: 50 } } });
    expect(await switchMethod('pls', yes)).toBe(false);
    expect(s().toasts.at(-1)?.text).toMatch(/covariance matrix/);
    useStore.setState({ data: null, model: { ...model, constructs: [...model.constructs, { ...C('H', 'factor'), indicators: [], components: ['B'] }] } });
    expect(await switchMethod('pls', yes)).toBe(false);
    expect(s().settings.method).toBe('cbsem');
  });
});
