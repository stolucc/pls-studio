// Card populations whose builders rescale paths: the R² they promise.

import { describe, expect, it } from 'vitest';
import { buildPopulation, type PopulationSpec } from '../../engine/population';
import { aguirre2018Population } from './model';

describe('Aguirre-Urreta & Rönkkö (2018) population', () => {
  it('keeps R² at 3 · .48² whatever the exogenous correlation (.3795 at .3, as in the paper)', () => {
    for (const r of [0, 0.3, 0.5]) {
      const pop = buildPopulation(aguirre2018Population(r) as PopulationSpec);
      const e1 = pop.constructs.indexOf('E1');
      expect(pop.r2[e1]!, `r = ${r}`).toBeCloseTo(0.6912, 3);
    }
    expect(aguirre2018Population(0.3).paths[0].value).toBe(0.3795);
    expect(aguirre2018Population(0).paths[0].value).toBeCloseTo(0.48, 12);
  });
});
