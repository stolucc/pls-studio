// CB-SEM example with correlated measurement errors: Bollen's (1989)
// industrialisation and political democracy model (Structural Equations with
// Latent Variables, Wiley), 75 developing countries. The same indicator was
// measured in 1960 and 1965, and y2/y4, y6/y8 share a data source, hence six
// error covariances. The data are Bollen's, as distributed with lavaan.

import csv from './political_democracy.csv?raw';
import { parseCsv } from '../engine/dataset';
import type { Dataset } from '../engine/types';
import { newId, type DataInfo, type ModelState, type Settings } from '../model/project';

export function makePoldemExample(settings: Settings): { name: string; data: Dataset; info: DataInfo; model: ModelState; settings: Settings } {
  const { dataset } = parseCsv(csv);
  const C = (name: string, indicators: string[], x: number, y: number, side: 'left' | 'right') =>
    ({ id: newId('c'), name, type: 'factor' as const, mode: 'A' as const, indicators, x, y, side });
  const ind60 = C('ind60', ['x1', 'x2', 'x3'], 0, 0, 'left');
  const dem60 = C('dem60', ['y1', 'y2', 'y3', 'y4'], 380, -150, 'right');
  const dem65 = C('dem65', ['y5', 'y6', 'y7', 'y8'], 380, 150, 'right');
  const P = (f: { id: string }, t: { id: string }) => ({ id: newId('p'), from: f.id, to: t.id });
  const E = (a: string, b: string) => ({ id: newId('k'), kind: 'indicator' as const, a, b });
  return {
    name: 'Industrialisation and political democracy',
    data: dataset,
    info: { fileName: 'political_democracy.csv', rows: dataset.cols[0].length, missingCells: 0, excluded: [] },
    model: {
      constructs: [ind60, dem60, dem65],
      paths: [P(ind60, dem60), P(ind60, dem65), P(dem60, dem65)],
      moderations: [],
      correlations: [E('y1', 'y5'), E('y2', 'y4'), E('y2', 'y6'), E('y3', 'y7'), E('y4', 'y8'), E('y6', 'y8')],
    },
    settings: { ...settings, method: 'cbsem', estimator: 'ML' },
  };
}
