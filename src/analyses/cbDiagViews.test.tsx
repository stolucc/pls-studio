// @vitest-environment happy-dom
// The CB-SEM diagnostics cards' result views render their tables from results shaped as the bridge returns them.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { parseCompareModels, parseDiscriminant, parseEpc, parseLocalFit } from '../rengine/cbDiag';
import { CompareModelsView, DiscriminantView, EpcView, LocalFitView } from './cbDiag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const engine = { package: 'x', version: '1' };

function render(node: React.ReactNode): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  const text = host.textContent ?? '';
  act(() => root.unmount());
  host.remove();
  return text;
}

it('local fit: the largest residuals first, Bonferroni level, SRMR and test rows', () => {
  const r = parseLocalFit({ blocks: [{ label: '', names: ['a', 'b', 'c'], residual: [[0, 0.1, -0.2], [0.1, 0, 0.05], [-0.2, 0.05, 0]], se: [[0, 0.05, 0.05], [0.05, 0, 0.05], [0.05, 0.05, 0]], z: [[0, 2, -4], [2, 0, 1], [-4, 1, 0]], normalized: null, means: null,
    summary: { srmr: 0.06, se: 0.01, z: 3, p: 0.001, usrmr: 0.05, low: 0.03, high: 0.07, h0: 0.05, closeP: 0.4 } }],
    tests: [{ test: 'standard', stat: 85.3, df: 24, p: 1e-8 }, { test: 'peba4', error: 'FMG tests require ML' }], base: 'standard', estimator: 'ML', n: 301, engine });
  const t = render(<LocalFitView r={r} top={2} />);
  expect(t).toContain('Largest residuals (2 of 3 pairs)');
  expect(t.indexOf('a ↔ c')).toBeLessThan(t.indexOf('a ↔ b'));
  expect(t).not.toContain('b ↔ c');
});

it('discriminant validity: both classifications per pair', () => {
  const r = parseDiscriminant({ level: 0.95, lhs: ['A'], rhs: ['B'], est: [0.97], low: [0.92], high: [1.03], cut80: { chisq: [0], df: [1], p: [1] }, cut90: { chisq: [0], df: [1], p: [1] }, cut100: { chisq: [0.7], df: [1], p: [0.4] }, markers: true, engine });
  const t = render(<DiscriminantView r={r} />);
  expect(t.match(/Severe problem/g)).toHaveLength(2);
  expect(t).toContain('semTools refitted it');
});

it('model comparison: fit, NET verdict and Vuong rows', () => {
  const r = parseCompareModels({ fit1: { npar: 21, df: 24, aic: 7517 }, fit2: { npar: 18, df: 27, aic: 7738 }, n: 301, net: { nested12: null, nested21: true, reason12: '', reason21: '', crit: 1e-7 },
    lrt: { chisq: 227, df: 3, p: 1e-49, method: '' }, vuong: { nested: true, stat: 227, pA: 1e-8 }, icci: { error: 'nested models' }, nestedChoice: 'auto', engine: { ...engine, lavaan: '0.7-3' } });
  const t = render(<CompareModelsView r={r} />);
  expect(t).toContain('Model 2 is nested in model 1');
  expect(t).toContain('Vuong’s test for nested models');
  expect(t).toContain('nested models');
});

it('EPC judgement: the summary and only the flagged parameters by default', () => {
  const r = parseEpc({ lhs: ['x1', 'x2'], op: ['~~', '=~'], rhs: ['x2', 'x9'], group: [1, 1], mi: [16, 0.1], epc: [0.3, 0.01], stdEpc: [0.24, 0.01], stdSesoi: [0.1, 0.4], significant: [true, false], highPower: [false, true], power: [0.4, 0.95],
    decisionPow: ['M', 'NM'], lowStd: [0.14, -0.1], highStd: [0.33, 0.1], decisionCi: ['M', 'NM'], settings: { stdLoad: 0.4, cor: 0.1, stdBeta: 0.1, stdIntcept: 0.2, cilevel: 0.9, mialpha: 0.05, mipower: 0.8, adjust: 'none' }, engine });
  const t = render(<EpcView r={r} show="flagged" />);
  expect(t).toContain('substantial misspecification');
  expect(t).toContain('x1 ↔ x2');
  expect(t).not.toContain('x2 → x9');
  expect(render(<EpcView r={r} show="all" />)).toContain('x2 → x9');
});
