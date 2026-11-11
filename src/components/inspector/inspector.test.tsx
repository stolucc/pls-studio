// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Construct,
  type ModelState,
  type Settings,
} from '../../model/project';
import { useStore } from '../../store';
import { Inspector } from '../Inspector';

// Pins the Inspector's markup for the model and for constructs of each kind, under each method: the model and construct
// inspectors are composed of section components (inspector/), which must render exactly what the single components did.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function render() {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<Inspector />));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}

const C = (
  id: string,
  name: string,
  indicators: string[],
  extra: Partial<Construct> = {},
): Construct => ({
  id,
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
  ...extra,
});
const names = ['a1', 'a2', 'a3', 'b1', 'b2', 'd1', 'e1'];
const data = {
  names,
  cols: names.map((_, k) => Float64Array.from({ length: 50 }, (_, i) => (i * (k + 2)) % 7)),
};
const model: ModelState = {
  constructs: [
    C('A', 'Alpha', ['a1', 'a2', 'a3'], { reliabilities: { a2: 0.8 }, dominant: 'a1' }),
    C('B', 'Beta', ['b1', 'b2'], {
      type: 'composite',
      mode: 'B',
      predefinedWeights: { b1: 1, b2: 0.5 },
    }),
    C('D', 'Delta', ['d1'], { reliability: 0.9, categorical: 'indicator' }),
    C('E', 'Epsilon', ['e1'], { covariate: true }),
    C('G', 'Gamma', [], { components: ['A', 'B'], componentLoadings: { B: 1 }, markerFree: true }),
    C('L', 'Lambda', ['a1', 'a2'], { latent: true, scaling: 'variance' }),
  ],
  paths: [
    { id: 'p1', from: 'A', to: 'D' },
    { id: 'p2', from: 'B', to: 'D' },
    { id: 'p3', from: 'G', to: 'D' },
  ],
  moderations: [{ id: 'm1', moderator: 'B', path: 'p1' }],
  correlations: [{ id: 'r1', kind: 'construct', a: 'A', b: 'E', zero: true }],
  ordered: ['a3'],
  information: 'observed',
};

const VARIANTS: [string, Partial<Settings>][] = [
  ['pls', { method: 'pls' }],
  [
    'pls seminr mi',
    {
      method: 'pls',
      plsPackage: 'seminr',
      missing: 'mi',
      consistent: true,
      bootInterval: 'studentized',
    },
  ],
  [
    'pls cSEM gsca builtin',
    { method: 'pls', plsApproach: 'GSCA', engine: 'builtin', hocApproach: 'embedded' },
  ],
  ['cbsem', { method: 'cbsem' }],
  [
    'cbsem wlsmv twostage',
    { method: 'cbsem', estimator: 'WLSMV', missing: 'twostage', interaction: 'lms' },
  ],
  [
    'cbsem mi amelia',
    {
      method: 'cbsem',
      missing: 'mi',
      miMethod: 'amelia',
      miAuxiliary: ['e1'],
      miNominal: ['e1'],
      estimator: 'MLR',
      bootTails: 'one',
    },
  ],
  ['cbsem 2sls', { method: 'cbsem', estimator: '2SLS', interaction: 'qml', bootInterval: 'bca' }],
  ['process', { method: 'process', hc: 'HC3', probe: 'meansd' }],
];

const show = (s: Partial<Settings>, nodes: string[]) => {
  useStore.setState({
    model,
    data,
    settings: { ...DEFAULT_SETTINGS, ...s },
    selection: { nodes, edges: [] },
  });
  return render();
};

describe('Inspector markup', () => {
  beforeEach(() => useStore.getState().newProject());
  it.each(VARIANTS)('model, %s', (_n, s) => expect(show(s, [])).toMatchSnapshot());
  it.each(VARIANTS)('every construct, %s', (_n, s) =>
    expect(
      Object.fromEntries(model.constructs.map((c) => [c.name, show(s, [c.id])])),
    ).toMatchSnapshot(),
  );
});
