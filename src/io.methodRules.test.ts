// Imports that need CB-SEM (a covariance matrix, model syntax) change the method by the rules
// of methodSwitch.ts, not by setting it directly.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogs = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  number: vi.fn<() => Promise<number | null>>(),
  form: vi.fn<() => Promise<string[] | null>>(),
}));
vi.mock('./components/Overlays', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./components/Overlays')>()),
  confirmDialog: dialogs.confirm,
  numberDialog: dialogs.number,
  formDialog: dialogs.form,
}));

import { importCsv, importModelSyntax } from './io';
import { DEFAULT_SETTINGS, type ModelState } from './model/project';
import { useStore } from './store';

const C = (id: string, type: 'factor' | 'composite', indicators: string[]) => ({
  id,
  name: id,
  type,
  mode: type === 'composite' ? ('B' as const) : ('A' as const),
  indicators,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const moderated: ModelState = {
  constructs: [C('X', 'composite', ['x1']), C('Y', 'factor', ['y1']), C('W', 'factor', ['w1'])],
  paths: [{ id: 'p', from: 'X', to: 'Y' }],
  moderations: [{ id: 'mo', moderator: 'W', path: 'p' }],
};
const matrix = ',x1,y1,w1\nx1,1,0.3,0.2\ny1,0.3,1,0.1\nw1,0.2,0.1,1\n';
const s = () => useStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  s().newProject();
  useStore.setState({
    model: moderated,
    settings: { ...DEFAULT_SETTINGS, method: 'process' },
    past: [],
    future: [],
    toasts: [],
  });
});

describe('a covariance matrix import', () => {
  it('leaves process analysis by the rules: main effects drawn, composites converted on confirmation', async () => {
    dialogs.number.mockResolvedValue(100);
    // No NACOV file; then convert the composite.
    dialogs.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await importCsv(new File([matrix], 'cov.csv'));
    expect(s().data?.moments?.n).toBe(100);
    expect(s().settings.method).toBe('cbsem');
    expect(s().model.paths.map((p) => [p.from, p.to])).toEqual([
      ['X', 'Y'],
      ['W', 'Y'],
    ]);
    expect(s().model.constructs[0].type).toBe('factor');
    expect(s().toasts.at(-1)?.text).toMatch(/Switched to CB-SEM/);
  });

  it('keeps the method and the model when the conversion is declined, and says so', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, method: 'pls' } });
    dialogs.number.mockResolvedValue(100);
    dialogs.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await importCsv(new File([matrix], 'cov.csv'));
    expect(s().data?.moments?.n).toBe(100);
    expect(s().settings.method).toBe('pls');
    expect(s().model).toBe(moderated);
    expect(s().toasts.at(-1)?.text).toMatch(/Switch the method to CB-SEM/);
  });
});

describe('a model syntax import', () => {
  it('in process analysis switches to CB-SEM by the rules', async () => {
    useStore.setState({ model: { constructs: [], paths: [], moderations: [] } });
    dialogs.form.mockResolvedValue(['F =~ x1 + x2 + x3\nG =~ y1 + y2 + y3\nG ~ F']);
    await importModelSyntax();
    expect(s().model.constructs.map((c) => c.name)).toEqual(['F', 'G']);
    expect(s().settings.method).toBe('cbsem');
  });
});
