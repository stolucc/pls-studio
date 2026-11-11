// The EFA card's result views that need a run: Tucker's congruence with a second solution. (The numbers against
// desktop psych: src/rengine/efa.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EfaResult } from '../rengine/efa';
import { CongruenceTables, SchmidTables } from './efa';

const result = {
  method: 'minres',
  rotation: 'oblimin',
  oblique: true,
  n: 100,
  k: 2,
  variables: ['a', 'b', 'c', 'd'],
  factors: ['MR1', 'MR2'],
  loadings: [
    [0.8, 0],
    [0.7, 0.1],
    [0, 0.8],
    [0.1, 0.7],
  ],
  congruence: {
    method: 'pca',
    rotation: 'varimax',
    factors: ['RC1', 'RC2'],
    coefficients: [
      [0.12, -0.97],
      [0.9, 0.2],
    ],
    loadings: [
      [0.1, 0.85],
      [0.2, 0.75],
      [0.82, 0.1],
      [0.75, 0.2],
    ],
  },
} as unknown as EfaResult;

describe('congruence view', () => {
  it('shows each factor’s best match with Lorenzo-Seva & ten Berge’s reading and their source', () => {
    const html = renderToStaticMarkup(<CongruenceTables r={result} unit="factor" />);
    expect(html).toContain('Best matches: 1 of 2 factors reappear in the second solution');
    expect(html).toContain(
      'minimum residual, oblimin (rows) and principal components (pca), varimax (columns)',
    );
    expect(html).toContain('>equal<');
    expect(html).toContain('>fair similarity<');
    expect(html).toContain('Methodology, 2(2), 57–64');
    expect(html).toContain('Loadings of the second solution');
  });
});

describe('Schmid–Leiman view', () => {
  const sl = {
    available: true as const,
    firstOrder: ['F1', 'F2', 'F3'],
    secondOrder: [0.8, 0.7, 0.6],
    groups: ['F1*', 'F2*', 'F3*'],
    general: [0.5, 0.4, 0.45, 0.3],
    group: [
      [0.5, 0, 0],
      [0, 0.4, 0],
      [0, 0, 0.6],
      [0.3, 0, 0],
    ],
    h2: [0.5, 0.32, 0.5625, 0.18],
    u2: [0.5, 0.68, 0.4375, 0.82],
    p2: [0.5, 0.5, 0.36, 0.5],
    ecv: 0.6,
    omegaH: 0.55,
    omegaTotal: 0.8,
    omegaLimit: 0.7,
    alpha: 0.75,
    omegaGroup: [
      { name: 'g', total: 0.8, general: 0.55, group: 0.25 },
      { name: 'F1*', total: 0.6, general: 0.3, group: 0.3 },
    ],
    reversed: ['b'],
  };

  it('shows the omegas, the second-order loadings and the orthogonal loadings, reversed items marked', () => {
    const html = renderToStaticMarkup(
      <SchmidTables r={{ ...result, k: 3, schmid: sl } as EfaResult} />,
    );
    expect(html).toContain('ω hierarchical (general factor)');
    expect(html).toContain('Explained common variance of g (ECV)');
    expect(html).toContain('Second-order loadings');
    expect(html).toContain('F1 (group factor F1*)');
    expect(html).toContain('b (reversed)');
    expect(html).toContain('All items (g)');
    expect(html).toContain('Schmid, J., &amp; Leiman, J. M. (1957)');
  });

  it('says why there is none when fewer than three factors were retained', () => {
    const html = renderToStaticMarkup(
      <SchmidTables r={{ ...result, schmid: { available: false } } as EfaResult} />,
    );
    expect(html).toContain('needs three or more factors; the criterion retained 2');
  });
});
