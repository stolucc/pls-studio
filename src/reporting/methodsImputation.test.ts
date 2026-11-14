// The methods text names the imputation R actually ran: PLS imputes with mice whatever the
// setting (which may still say Amelia or joint imputation from a CB-SEM model).

import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { methodsText } from './methods';
import { plsInput, plsResult } from './fixtures';

it('PLS with multiple imputation: the method R reports, not the setting', () => {
  const settings = { ...DEFAULT_SETTINGS, bootSamples: 5000, missing: 'mi' as const };
  const amelia = methodsText(
    plsInput({
      settings: { ...settings, miMethod: 'amelia' },
      pls: plsResult({ imputations: 20, imputationMethod: 'mice' }),
    }),
  ).text;
  expect(amelia).toContain('by chained equations with mice');
  expect(amelia).toContain('(predictive mean matching)');
  expect(amelia).not.toContain('Amelia');
  const norm = methodsText(
    plsInput({
      settings: { ...settings, miMethod: 'micenorm' },
      pls: plsResult({ imputations: 20, imputationMethod: 'micenorm' }),
    }),
  ).text;
  expect(norm).toContain('(Bayesian normal regression)');
  // (a stored result from before the method was reported: PLS always used predictive mean matching)
  const old = methodsText(
    plsInput({ settings: { ...settings, miMethod: 'joint' }, pls: plsResult({ imputations: 20 }) }),
  ).text;
  expect(old).toContain('(predictive mean matching)');
});
