// The APIM (R/apim.R) against the reference run natively (scripts/validation/apim.R →
// src/engine/__fixtures__/apim.json): the latent APIM as dySEM 1.4.1 writes it (scriptAPIM) on its
// commitmentM couples, distinguishable and indistinguishable, with their LR test of distinguishability;
// and the observed APIM on the partners' mean scores, written out by hand as Kenny, Kashy & Cook (2006)
// give it, with the bootstrap interval of k.
// No published numbers with open data were found, so the references are dySEM's syntax and hand-written
// lavaan syntax fitted natively. Estimates come from lavaan's optimiser: webR's floating point moves them
// by ~1e-6 relative, hence 1e-5 (relative). Run with WEBR_TESTS=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near, same } from '../validation/record';
import { apimR, apimScriptR, type ApimInput, type ApimResult } from './apim';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'apim.json'), 'utf8'));
const CSV = join(__dirname, '..', '..', 'public', 'examples', 'dyadic', 'commitmentM.csv');

/** dySEM's commitmentM as shipped with the example (empty cells are missing values). */
function commitment(): Dataset {
  const lines = readFileSync(CSV, 'utf8').trim().split('\n');
  const names = lines[0].split(',').map((n) => n.replace(/"/g, ''));
  const rows = lines.slice(1).map((l) => l.split(',').map((v) => (v === '' ? NaN : Number(v))));
  return { names, cols: names.map((_, j) => Float64Array.from(rows, (r) => r[j])) };
}

/** The data with each partner's mean scores added (NaN when an item is missing, as rowMeans). */
function withMeans(d: Dataset): Dataset {
  const col = (n: string) => d.cols[d.names.indexOf(n)];
  const mean = (stem: string, who: string) => {
    const items = [1, 2, 3, 4, 5].map((i) => col(`${stem}${i}_${who}`));
    return Float64Array.from(items[0], (_, r) => items.reduce((s, c) => s + c[r], 0) / 5);
  };
  return {
    names: [...d.names, 'sat_f', 'sat_m', 'com_f', 'com_m'],
    cols: [...d.cols, mean('sat.g', 'f'), mean('sat.g', 'm'), mean('com', 'f'), mean('com', 'm')],
  };
}

const items = (stem: string, who: string) => [1, 2, 3, 4, 5].map((i) => `${stem}${i}_${who}`);
const LATENT: ApimInput = {
  x1: items('sat.g', 'f'), x2: items('sat.g', 'm'), y1: items('com', 'f'), y2: items('com', 'm'),
  dyads: 'distinguishable', estimator: 'ML', missing: 'casewise',
};
const OBSERVED: ApimInput = { ...LATENT, x1: ['sat_f'], x2: ['sat_m'], y1: ['com_f'], y2: ['com_m'] };

/**
 * Recorded, relative to the size of the value. The default 1e-4 is for the estimates: the reference fits the
 * same model from dySEM's syntax, whose different order of the parameters leaves lavaan's optimiser at a
 * point that agrees to about 1e-5 relative (the χ² to far less); webR adds ~1e-6.
 */
const rel = (what: string, got: number | null, want: number, tol = 1e-4) => {
  near(what, got ?? NaN, want, tol * Math.max(1, Math.abs(want)));
};

type RefModel = { fit: { chisq: number; df: number; cfi: number; rmsea: number }; n: number; params: Record<string, { est: number; se: number; std: number; low: number; high: number }>; xCor: number; yCor: number };

function sameModel(r: ApimResult, ref: RefModel, what: string) {
  same(`${what}: N`, r.n, ref.n);
  rel(`${what}: χ²`, r.fit.chisq, ref.fit.chisq);
  same(`${what}: df`, r.fit.df ?? NaN, ref.fit.df);
  if (ref.fit.df > 0) {
    rel(`${what}: CFI`, r.fit.cfi, ref.fit.cfi);
    rel(`${what}: RMSEA`, r.fit.rmsea, ref.fit.rmsea);
  }
  for (const e of [...r.effects, ...r.k]) {
    const p = ref.params[e.label];
    rel(`${what}: ${e.label}`, e.est, p.est);
    rel(`${what}: SE of ${e.label}`, e.se, p.se);
    rel(`${what}: CI of ${e.label} (lower)`, e.low, p.low);
    if (e.std !== null) rel(`${what}: standardised ${e.label}`, e.std, p.std);
  }
  rel(`${what}: X correlation`, r.xCor.std, ref.xCor);
  rel(`${what}: Y residual correlation`, r.yCor.std, ref.yCor);
}

describe('the APIM (lavaan)', () => {
  it('latent, distinguishable: dySEM’s scriptAPIM with loadings and intercepts invariant', async () => {
    const r = await apimR(commitment(), LATENT);
    sameModel(r, REF.latent.dist, 'latent distinguishable');
    expect(r.effects.map((e) => e.label)).toEqual(['a1', 'a2', 'p1', 'p2']);
    expect(r.k.map((e) => e.label)).toEqual(['k1', 'k2']);
    expect(r.latent).toEqual({ x: true, y: true });
    rel('test of distinguishability: χ²', r.test.chisqDiff, REF.latent.test.chisqDiff);
    same('test of distinguishability: df', r.test.dfDiff ?? NaN, REF.latent.test.dfDiff);
    rel('test of distinguishability: p', r.test.p, REF.latent.test.p, 1e-4);
  }, 600_000);

  it('latent, indistinguishable: dySEM’s scriptAPIM with its default constraints', async () => {
    const r = await apimR(commitment(), { ...LATENT, dyads: 'indistinguishable' });
    sameModel(r, REF.latent.indist, 'latent indistinguishable');
    expect(r.k.map((e) => e.label)).toEqual(['k']);
    rel('distinguishable fit alongside: χ²', r.distFit.chisq, REF.latent.dist.fit.chisq);
  }, 600_000);

  it('latent, distinguishable, FIML: the couples with missing items kept', async () => {
    const r = await apimR(commitment(), { ...LATENT, missing: 'fiml' });
    sameModel(r, REF.latent.fimlDist, 'latent distinguishable FIML');
  }, 600_000);

  it('observed mean scores: Kenny’s APIM, the test of distinguishability (6 df) and the bootstrap interval of k', async () => {
    const data = withMeans(commitment());
    const d = await apimR(data, OBSERVED);
    sameModel(d, REF.observed.dist, 'observed distinguishable');
    const boot = { samples: 1000, seed: 1234, level: 0.95 };
    const r = await apimR(data, { ...OBSERVED, dyads: 'indistinguishable', boot });
    sameModel(r, REF.observed.indist, 'observed indistinguishable');
    rel('test of distinguishability: χ²', r.test.chisqDiff, REF.observed.test.chisqDiff);
    same('test of distinguishability: df', r.test.dfDiff ?? NaN, 6);
    for (const e of [...r.effects, ...r.k]) {
      // (percentile bounds are order statistics of the resamples: the same draws give the same values)
      rel(`bootstrap CI of ${e.label}, lower`, e.bootLow, REF.observed.boot[e.label].low, 1e-4);
      rel(`bootstrap CI of ${e.label}, upper`, e.bootHigh, REF.observed.boot[e.label].high, 1e-4);
    }
  }, 900_000);

  it('exports the script it runs', async () => {
    const script = await apimScriptR(commitment(), { ...LATENT, dyads: 'indistinguishable' });
    expect(script).toContain('distinguishability <- lavTestLRT(fit_indist, fit_dist)');
    expect(script).toContain('k := p/a');
    expect(script).toContain('X1 =~ NA*sat_g1_f + lx1*sat_g1_f');
  }, 300_000);
});
