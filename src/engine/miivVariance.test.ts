// The built-in MIIV-2SLS variance step (coefficients fixed, variances by ML)
// against MIIVsem's var.cov = TRUE with lavaan's standardisation, recorded in
// src/rengine/__fixtures__/*.r.json by running the R bridge on these cases.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMiiv } from '../rengine/analyses';
import { estimateMiiv } from './miiv';
import { cases, close, loadData, toSpec } from './validationHarness';

const NAMES = ['miiv_miivsem_hs', 'miiv_miivsem_poldem', 'miiv_miivsem_mobi', 'miiv_miivsem_emse', 'cov_miivsem_bollen'];
const TOL = 1e-4;

describe.each(NAMES)('MIIV-2SLS variance step vs MIIVsem: %s', (name) => {
  it('standardised coefficients, (co)variances and R² agree', () => {
    const c = cases.find((k) => k.name === name)!;
    const ref = parseMiiv(JSON.parse(readFileSync(join(__dirname, '..', 'rengine', '__fixtures__', `${name}.r.json`), 'utf8')));
    const mine = estimateMiiv(loadData(c), toSpec(c));
    for (const e of ref.estimates) {
      if (e.std === undefined) continue;
      const m = mine.estimates.find((x) => x.lhs === e.lhs && x.op === e.op && x.rhs === e.rhs);
      close(m?.std, e.std, TOL, `std ${e.lhs} ${e.op} ${e.rhs}`);
    }
    for (const [k, v] of Object.entries(ref.fixedStd ?? {})) close(mine.fixedStd?.[k], v, TOL, `marker ${k}`);
    for (const v of ref.variances ?? []) {
      const m = mine.variances?.find((x) => (x.lhs === v.lhs && x.rhs === v.rhs) || (x.lhs === v.rhs && x.rhs === v.lhs));
      expect(m, `${v.lhs} ~~ ${v.rhs}`).toBeDefined();
      close(m!.est, v.est, TOL, `var ${v.lhs} ~~ ${v.rhs}`);
      close(m!.std, v.std, TOL, `std var ${v.lhs} ~~ ${v.rhs}`);
    }
    for (const [k, v] of Object.entries(ref.r2 ?? {})) close(mine.r2?.[k], v, TOL, `R² ${k}`);
  });
});
