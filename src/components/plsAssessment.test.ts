import { expect, it } from 'vitest';
import { predictivePower } from './PlsAssessmentPanel';

const row = (q2: number, rmsePls: number, rmseLm: number) => ({ indicator: 'i', construct: 'C', maePls: 1, maeLm: 1, rmsePls, rmseLm, q2 });

it('classifies predictive power as Shmueli et al. (2019)', () => {
  expect(predictivePower([row(0.2, 1, 2), row(0.1, 1, 2)])).toMatch(/^High/);
  expect(predictivePower([row(0.2, 1, 2), row(0.1, 1, 2), row(0.1, 3, 2)])).toMatch(/^Medium/);
  expect(predictivePower([row(0.2, 1, 2), row(0.1, 3, 2), row(0.1, 3, 2)])).toMatch(/^Low/);
  expect(predictivePower([row(0.2, 3, 2)])).toMatch(/^No predictive power/);
  expect(predictivePower([row(-0.1, 1, 2)])).toMatch(/not above 0/);
});
