// The cSEM / seminr bridge's output mapping, checked against the validation
// corpus without running R: __fixtures__/*.r.json were recorded by running
// R/pls.R (ps_pls) in native R on the corpus requests. The same comparison
// through webR is in pls.webr.test.ts (npm run test:webr).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cases, checkPls, loadData, toSpec } from '../engine/validationHarness';
import { parsePlsOutput, plsRequest } from './pls';

export const PLS_R_CASES = ['pls_csem_threecommonfactors', 'plsc_csem_threecommonfactors', 'plsc_csem_satisfaction', 'plsc_csem_mobi_mixed',
  'composite_csem_satisfaction', 'pls_seminr_mobi_A', 'pls_seminr_mobi_B', 'pls_seminr_corp_rep', 'pls_seminr_moderation_mobi', 'pls_seminr_moderation_corp_rep'];

describe.each(PLS_R_CASES)('PLS output mapping: %s', (name) => {
  it('reproduces the reference values', () => {
    const c = cases.find((k) => k.name === name)!;
    const res = parsePlsOutput(JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${name}.r.json`), 'utf8')));
    expect(res.engine.package).toBe(c.source);
    expect(res.converged).toBe(true);
    checkPls(c, res);
  });
});

describe('PLS request', () => {
  it('refuses covariance-matrix data and passes the estimation options', () => {
    const c = cases.find((k) => k.name === 'pls_csem_threecommonfactors')!;
    const opts = { scheme: 'path' as const, consistent: true, missing: 'mean' as const, tolerance: 1e-7, maxIter: 300 };
    const req = plsRequest(loadData(c), toSpec(c), opts, 'cSEM');
    expect(req.options).toEqual({ scheme: 'path', consistent: true, tolerance: 1e-7, maxIter: 300 });
    expect(() => plsRequest({ names: ['a'], cols: [], moments: { S: [[1]], n: 10 } }, toSpec(c), opts, 'cSEM')).toThrow(/raw data/);
  });
});
