// The failed-HTMT helper's rules (thresholds, verdicts and their edge cases) and its
// computations against the built-in engine's own HTMT, loadings and correlations.

import { describe, expect, it } from 'vitest';
import { estimatePls } from '../engine/pls';
import type { PlsResult } from '../engine/types';
import { toSpec } from '../model/project';
import { mobi, REFERENCE_OPTIONS } from './__fixtures__/data';
import {
  correlations,
  fornellLarckerPair,
  HTMT_DISTINCT,
  HTMT_SIMILAR,
  htmtOfPairs,
  htmtPairs,
  htmtThreshold,
  htmtVariantOf,
  htmtVerdict,
  indicatorData,
  pairDrivers,
  pairHtmt,
  quantileType7,
  scoreCorrelation,
} from './htmt';

describe('thresholds and verdicts (Henseler et al. 2015; Franke & Sarstedt 2019)', () => {
  it('uses 0.85 for distinct and 0.90 for conceptually similar constructs', () => {
    expect(HTMT_DISTINCT).toBe(0.85);
    expect(HTMT_SIMILAR).toBe(0.9);
    expect(htmtThreshold(false)).toBe(0.85);
    expect(htmtThreshold(true)).toBe(0.9);
  });

  it('fails at or above the threshold, whatever the bound', () => {
    expect(htmtVerdict(0.85, null, 0.85)).toBe('fails');
    expect(htmtVerdict(0.851, 0.8, 0.85)).toBe('fails');
    expect(htmtVerdict(0.9, null, 0.9)).toBe('fails');
    expect(htmtVerdict(0.89, null, 0.9)).toBe('unconfirmed');
  });

  it('a value just below the threshold with an upper bound reaching it is not established', () => {
    expect(htmtVerdict(0.84, 0.85, 0.85)).toBe('boundFails');
    expect(htmtVerdict(0.84, 0.91, 0.85)).toBe('boundFails');
    expect(htmtVerdict(0.84, 0.8499, 0.85)).toBe('established');
    // marked similar: the same values pass the 0.90 threshold
    expect(htmtVerdict(0.84, 0.88, htmtThreshold(true))).toBe('established');
  });

  it('is unconfirmed below the threshold until the bootstrap has run', () => {
    expect(htmtVerdict(0.5, undefined, 0.85)).toBe('unconfirmed');
    expect(htmtVerdict(0.5, null, 0.85)).toBe('unconfirmed');
    expect(htmtVerdict(0.5, NaN, 0.85)).toBe('unconfirmed');
  });
});

describe('quantileType7', () => {
  it('matches R’s quantile(type = 7)', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(quantileType7(xs, 0.95)).toBeCloseTo(9.55, 12); // quantile(1:10, 0.95)
    expect(quantileType7(xs, 0.5)).toBeCloseTo(5.5, 12);
    expect(quantileType7([3], 0.95)).toBe(3);
    expect(quantileType7([], 0.95)).toBeNaN();
  });
});

describe('the HTMT from indicator columns', () => {
  const { data, model } = mobi();
  const spec = toSpec(model);
  const pls = estimatePls(data, spec, REFERENCE_OPTIONS);
  const ind = indicatorData(data, spec, 'mean');

  it('equals the built-in engine’s HTMT for every pair', () => {
    const pairs = htmtPairs(pls);
    expect(pairs.length).toBe(21);
    const got = htmtOfPairs(
      ind,
      pairs.map((p) => [p.a, p.b]),
    );
    pairs.forEach((p, i) => expect(got[i], `${p.a}–${p.b}`).toBeCloseTo(p.htmt, 10));
  });

  it('the signed and absolute conventions agree when every correlation is positive', () => {
    const R = [
      [1, 0.5, 0.3, 0.2],
      [0.5, 1, 0.25, 0.35],
      [0.3, 0.25, 1, 0.6],
      [0.2, 0.35, 0.6, 1],
    ];
    const a = [0, 1];
    const b = [2, 3];
    const want = (0.3 + 0.2 + 0.25 + 0.35) / 4 / Math.sqrt(0.5 * 0.6);
    expect(pairHtmt(R, a, b, 'absolute')).toBeCloseTo(want, 12);
    expect(pairHtmt(R, a, b, 'signed')).toBeCloseTo(want, 12);
    // a negative heterotrait correlation: absolute counts its size, signed its sign
    const R2 = R.map((row) => row.slice());
    R2[0][2] = R2[2][0] = -0.3;
    expect(pairHtmt(R2, a, b, 'absolute')).toBeCloseTo(want, 12);
    expect(pairHtmt(R2, a, b, 'signed')).toBeCloseTo(
      (-0.3 + 0.2 + 0.25 + 0.35) / 4 / Math.sqrt(0.5 * 0.6),
      12,
    );
    // monotrait means of opposite signs: undefined
    const R3 = R.map((row) => row.slice());
    R3[0][1] = R3[1][0] = -0.5;
    expect(pairHtmt(R3, a, b, 'signed')).toBeNaN();
  });

  it('takes cSEM’s convention for cSEM results, seminr’s otherwise', () => {
    const withEngine = (pkg: string) => ({ ...pls, engine: { package: pkg } }) as PlsResult;
    expect(htmtVariantOf(withEngine('cSEM'))).toBe('signed');
    expect(htmtVariantOf(withEngine('seminr'))).toBe('absolute');
    expect(htmtVariantOf(pls)).toBe('absolute');
  });

  it('own-construct “cross-loadings” reproduce the engine’s loadings (PLS scores are weighted sums)', () => {
    const d = pairDrivers(ind, pls, 'Satisfaction', 'Quality');
    expect(d.items.length).toBe(3 + 7);
    const j = pls.constructs.indexOf('Quality');
    const block = ind.blocks.get('Quality')!;
    const R = correlations(ind.cols, block.concat(ind.blocks.get('Satisfaction')!));
    const local = block.map((_, i) => i);
    const w = block.map((k) => {
      const at = pls.indicators.findIndex((x) => x.name === ind.names[k] && x.construct === j);
      return pls.weights[at];
    });
    block.forEach((k, i) => {
      const at = pls.indicators.findIndex((x) => x.name === ind.names[k] && x.construct === j);
      expect(scoreCorrelation(R, i, local, w), ind.names[k]).toBeCloseTo(pls.loadings[at], 8);
    });
  });

  it('cross-loadings are the correlations with the other construct’s scores', () => {
    const d = pairDrivers(ind, pls, 'Satisfaction', 'Quality');
    const q = pls.constructs.indexOf('Quality');
    const scores = pls.scores[q];
    const item = d.items.find((x) => x.indicator === 'CUSA1')!;
    const col = ind.cols[ind.names.indexOf('CUSA1')];
    const n = col.length;
    const mean = (v: ArrayLike<number>) => Array.from(v).reduce((s, x) => s + x, 0) / n;
    const mx = mean(col);
    const my = mean(scores);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let r = 0; r < n; r++) {
      sxy += (col[r] - mx) * (scores[r] - my);
      sxx += (col[r] - mx) ** 2;
      syy += (scores[r] - my) ** 2;
    }
    expect(item.crossLoading).toBeCloseTo(sxy / Math.sqrt(sxx * syy), 8);
  });

  it('sorts items by heterotrait correlation and lists the largest item correlations first', () => {
    const d = pairDrivers(ind, pls, 'Satisfaction', 'Quality');
    for (let i = 1; i < d.items.length; i++)
      expect(d.items[i - 1].hetero).toBeGreaterThanOrEqual(d.items[i].hetero);
    expect(d.itemPairs.length).toBe(21);
    for (let i = 1; i < d.itemPairs.length; i++)
      expect(Math.abs(d.itemPairs[i - 1].r)).toBeGreaterThanOrEqual(Math.abs(d.itemPairs[i].r));
  });

  it('Fornell–Larcker: |r| against the smaller √AVE', () => {
    const fl = fornellLarckerPair(pls, 'Satisfaction', 'Quality')!;
    const i = pls.constructs.indexOf('Satisfaction');
    const j = pls.constructs.indexOf('Quality');
    expect(fl.r).toBe(pls.constructCor[i][j]);
    expect(fl.met).toBe(
      Math.abs(fl.r) < Math.min(Math.sqrt(pls.quality[i].ave), Math.sqrt(pls.quality[j].ave)),
    );
    expect(fornellLarckerPair(pls, 'Satisfaction', 'Nope')).toBeNull();
  });
});
