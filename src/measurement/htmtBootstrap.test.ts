// The HTMT bootstrap of the "What now?" helper against cSEM and seminr: the same resamples
// (drawn in R, recorded with the results by scripts/validation/htmt_bootstrap.R, cSEM 0.7.1,
// seminr 2.6.0), the HTMT of every pair in each resample (cSEM::calculateHTMT: signed mean
// correlations, the absolute value taken at the end, the 'signed' variant; seminr's HTMT:
// absolute correlations, the 'absolute' variant, as the built-in engine), and the upper bound
// of the one-sided 95% interval (the 95th percentile, type 7, as cSEM's CI_percentile;
// Franke & Sarstedt 2019). No R: the reference is recorded.

import { describe, expect, it } from 'vitest';
import type { ModelSpec } from '../engine/types';
import { near, same } from '../validation/record';
import { fixture, mobi, type HtmtBootstrapFixture } from './__fixtures__/data';
import { htmtDraws, htmtOfPairs, indicatorData, summariseHtmtDraws } from './htmt';

const ref = fixture<HtmtBootstrapFixture>('htmt_bootstrap.json');
const items = (prefix: string, k: number) =>
  Array.from({ length: k }, (_, i) => `${prefix}${i + 1}`);
// The reference's model: the ECSI constructs, all common factors, Complaints (one item) left out.
const spec: ModelSpec = {
  constructs: [
    { name: 'Image', mode: 'A', indicators: items('IMAG', 5) },
    { name: 'Expectation', mode: 'A', indicators: items('CUEX', 3) },
    { name: 'Quality', mode: 'A', indicators: items('PERQ', 7) },
    { name: 'Value', mode: 'A', indicators: items('PERV', 2) },
    { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) },
    { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) },
  ],
  paths: [],
};

describe('HTMT bootstrap against cSEM on the same resamples', () => {
  const ind = indicatorData(mobi().data, spec, 'mean');
  // R's row numbers are 1-based.
  const rowsOf = (b: number) => ref.indices[b].map((r) => r - 1);

  it('the HTMT of every pair on the data', () => {
    const got = htmtOfPairs(ind, ref.pairs, undefined, 'signed');
    ref.pairs.forEach(([a, b], i) => near(`HTMT ${a}–${b}`, got[i], ref.original[i], 1e-10));
  });

  it('the HTMT of every pair in every resample, and the 95% upper bound', () => {
    const B = ref.indices.length;
    const draws = htmtDraws(ind, ref.pairs, rowsOf, 0, B, 'signed');
    for (let b = 0; b < B; b++)
      ref.pairs.forEach(([x, y], i) =>
        expect(
          Math.abs(draws[i][b] - ref.draws[b][i]),
          `resample ${b + 1}, ${x}–${y}`,
        ).toBeLessThan(1e-10),
      );
    const boot = summariseHtmtDraws(ind, ref.pairs, draws, 0, 'signed');
    same('resamples', boot.samples, B);
    same('failed resamples', boot.failed, 0);
    boot.pairs.forEach((p, i) =>
      near(`95% upper bound ${p.a}–${p.b}`, p.upper, ref.upper95[i], 1e-10),
    );
  });

  it('seminr’s convention (absolute item correlations): the HTMT, every resample and the upper bound', () => {
    const got = htmtOfPairs(ind, ref.pairs, undefined, 'absolute');
    ref.pairs.forEach(([a, b], i) =>
      near(`HTMT (absolute) ${a}–${b}`, got[i], ref.originalAbsolute[i], 1e-10),
    );
    const B = ref.indices.length;
    const draws = htmtDraws(ind, ref.pairs, rowsOf, 0, B, 'absolute');
    for (let b = 0; b < B; b++)
      ref.pairs.forEach(([x, y], i) =>
        expect(
          Math.abs(draws[i][b] - ref.drawsAbsolute[b][i]),
          `resample ${b + 1}, ${x}–${y}`,
        ).toBeLessThan(1e-10),
      );
    const boot = summariseHtmtDraws(ind, ref.pairs, draws, 0, 'absolute');
    boot.pairs.forEach((p, i) =>
      near(`95% upper bound (absolute) ${p.a}–${p.b}`, p.upper, ref.upper95Absolute[i], 1e-10),
    );
  });
});
