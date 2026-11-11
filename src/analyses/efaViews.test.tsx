// The EFA card's result views that need a run: Tucker's congruence with a second solution. (The numbers against
// desktop psych: src/rengine/efa.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EfaResult } from '../rengine/efa';
import { CongruenceTables } from './efa';

const result = {
  method: 'minres', rotation: 'oblimin', oblique: true, n: 100, k: 2,
  variables: ['a', 'b', 'c', 'd'], factors: ['MR1', 'MR2'],
  loadings: [[0.8, 0], [0.7, 0.1], [0, 0.8], [0.1, 0.7]],
  congruence: {
    method: 'pca', rotation: 'varimax', factors: ['RC1', 'RC2'],
    coefficients: [[0.12, -0.97], [0.9, 0.2]],
    loadings: [[0.1, 0.85], [0.2, 0.75], [0.82, 0.1], [0.75, 0.2]],
  },
} as unknown as EfaResult;

describe('congruence view', () => {
  it('shows each factor’s best match with Lorenzo-Seva & ten Berge’s reading and their source', () => {
    const html = renderToStaticMarkup(<CongruenceTables r={result} unit="factor" />);
    expect(html).toContain('Best matches: 1 of 2 factors reappear in the second solution');
    expect(html).toContain('minimum residual, oblimin (rows) and principal components (pca), varimax (columns)');
    expect(html).toContain('>equal<');
    expect(html).toContain('>fair similarity<');
    expect(html).toContain('Methodology, 2(2), 57–64');
    expect(html).toContain('Loadings of the second solution');
  });
});
