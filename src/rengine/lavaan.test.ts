// The lavaan bridge's output mapping, checked against the validation corpus
// without running R: __fixtures__/*.lavaan.json were recorded by running
// R/lavaan.R (ps_cb) in native R on the corpus requests. The same comparison
// through webR is in lavaan.webr.test.ts (npm run test:webr).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { johnsonNeyman } from '../engine/jn';
import { cases, checkCbResult, loadData, toSpec } from '../engine/validationHarness';
import { cbRequest, parseCbOutput } from './lavaan';

const recorded = ['cov_lavaan_bollen_ml', 'emse_sem_mlm', 'emse_sem_ml', 'cbmod_lavaan_hs_ml', 'cbmod_lavaan_threecf_ml', 'cb_lavaan_threecf_mlr', 'cb_lavaan_threecf_mlmv'];

describe.each(recorded)('lavaan output mapping: %s', (name) => {
  it('reproduces the reference values', () => {
    const c = cases.find((k) => k.name === name)!;
    const res = parseCbOutput(JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${name}.lavaan.json`), 'utf8')));
    checkCbResult(c, res);
    expect(res.engine.package).toBe('lavaan');
  });
});

describe('lavaan request', () => {
  it('sends only the model columns, missing values as null', () => {
    const c = cases.find((k) => k.name === 'cov_lavaan_bollen_ml')!;
    const data = loadData(c);
    const d = { ...data, names: [...data.names, 'unused'], cols: [...data.cols, Float64Array.from(data.cols[0], () => NaN)] };
    d.cols[0] = Float64Array.from(d.cols[0], (v, i) => (i === 3 ? NaN : v));
    const req = cbRequest(d, toSpec(c), 'casewise', 'ML');
    expect(req.data.names).not.toContain('unused');
    expect(req.data.cols![0][3]).toBeNull();
    expect(req.model.covariances).toHaveLength(6);
  });
  it('passes covariance-matrix input through as moments', () => {
    const c = cases.find((k) => k.name === 'emse_sem_mlm')!;
    const req = cbRequest(loadData(c), toSpec(c), 'casewise', 'MLM');
    expect(req.data.cols).toBeUndefined();
    expect(req.data.moments!.n).toBe(155);
  });
  it('maps latent interactions so Johnson–Neyman works on lavaan output', () => {
    const res = parseCbOutput(JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'cbmod_lavaan_hs_ml.lavaan.json'), 'utf8')));
    expect(res.constructs).toContain('visual × textual');
    expect(() => johnsonNeyman(res, res.moderations[0])).not.toThrow();
  });
});

describe('the likelihood-ratio test of a latent interaction (modsem)', () => {
  it('is kept when the bridge reports it, and absent otherwise', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'cbmod_lavaan_hs_ml.lavaan.json'), 'utf8'));
    expect(parseCbOutput(raw).lrt).toBeUndefined();
    const withLrt = parseCbOutput({ ...raw, interaction: 'lms', lrt: { D: 6288.394, df: 1, p: 0, llChange: 3144.197 } });
    expect(withLrt.lrt).toEqual({ D: 6288.394, df: 1, p: 0, llChange: 3144.197 });
    expect(parseCbOutput({ ...raw, lrt: null }).lrt).toBeUndefined();
  });
});
