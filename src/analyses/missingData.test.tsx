// The missing-data card's MCAR tests: options survive a project file (old files without them run as before), what a
// run sends to R and with which packages, the inputs a run reads, and the view. (The results against misty and
// MissMech in desktop R: src/examples/cards/missing.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { missingDataRequest, type MissingDataResult } from '../rengine/screen';
import { littleText, missingDataAnalysis as card } from './missingData';
import type { AnalysisCtx } from './types';

const data = {
  names: ['a', 'b', 'c'],
  cols: [
    new Float64Array([1, NaN, 3, 4]),
    new Float64Array([2, 1, NaN, 3]),
    new Float64Array([5, 6, 7, 8]),
  ],
};
const ctx = {
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, seed: 7 },
  pls: null,
  projectName: 'p',
} as unknown as AnalysisCtx;
const little = {
  n: 153,
  incomplete: 42,
  patterns: 4,
  chisq: 35.1488664826,
  df: 14,
  p: 0.0013972546,
  byPattern: [
    { observed: [true, true, true], n: 2, k: 3, d2: 3.6 },
    { observed: [true, false, true], n: 1, k: 2, d2: 31.5488664826 },
  ],
};
const result = (more: Partial<MissingDataResult>): MissingDataResult => ({
  variables: ['a', 'b', 'c'],
  n: 4,
  patterns: [
    { observed: [true, true, true], n: 2 },
    { observed: [true, false, true], n: 1 },
    { observed: [false, true, true], n: 1 },
  ],
  coverage: [[0.75], [0.5, 0.75], [0.75, 0.75, 1]],
  em: {
    means: [1, 2, 3],
    cov: [[1], [0, 1], [0, 0, 1]],
    cor: [[1], [0, 1], [0, 0, 1]],
    loglik: -10,
    singular: false,
  },
  warnings: [],
  engine: { package: 'misty', version: '0.8.4', mvnmle: '0.1.11.2' },
  ...more,
});

describe('missing-data card: MCAR tests', () => {
  it('new cards run Little’s test; project files without the options keep the old summary', () => {
    expect(card.defaults(ctx)).toMatchObject({ mcar: true, jamjal: false });
    expect(card.parseOptions({ vars: ['a', 'b'], measures: [], descriptive: [] })).toEqual({
      vars: ['a', 'b'],
      measures: [],
      descriptive: [],
      mcar: false,
      jamjal: false,
    });
    expect(
      card.parseOptions({
        vars: ['a', 'b'],
        measures: [],
        descriptive: [],
        mcar: 'yes',
        jamjal: true,
      }),
    ).toMatchObject({ mcar: false, jamjal: true });
    const o = { ...card.defaults(ctx), vars: ['a', 'b'] };
    expect(card.parseOptions(o)).toEqual(o);
  });
  it('need 2 to 50 variables', () => {
    expect(card.blocked({ ...card.defaults(ctx), vars: ['a'] }, ctx)).toMatch(/2 to 50/);
    expect(card.blocked({ ...card.defaults(ctx), vars: ['a'], mcar: false }, ctx)).toBeNull();
    expect(card.blocked({ ...card.defaults(ctx), vars: ['a', 'b'] }, ctx)).toBeNull();
  });
  it('send the tests (and the seed only for Jamshidian & Jalal’s imputations) to R', () => {
    const base = { vars: ['a', 'b'], measures: [], descriptive: [] };
    const plain = missingDataRequest(data, base);
    expect(plain).not.toHaveProperty('mcar');
    expect(plain).not.toHaveProperty('seed');
    expect(missingDataRequest(data, { ...base, mcar: true, seed: 7 })).toMatchObject({
      mcar: true,
    });
    expect(missingDataRequest(data, { ...base, mcar: true, seed: 7 })).not.toHaveProperty('seed');
    expect(missingDataRequest(data, { ...base, jamjal: true, seed: 7 })).toMatchObject({
      jamjal: true,
      seed: 7,
    });
  });
  it('rerun when the tests or, for Jamshidian & Jalal, the seed change', () => {
    const o = { ...card.defaults(ctx), vars: ['a', 'b'] };
    const f = card.fingerprint(o, ctx);
    expect(card.fingerprint({ ...o, mcar: false }, ctx)).not.toBe(f);
    expect(card.fingerprint(o, { ...ctx, settings: { ...ctx.settings, seed: 8 } })).toBe(f);
    const j = { ...o, jamjal: true };
    expect(card.fingerprint(j, { ...ctx, settings: { ...ctx.settings, seed: 8 } })).not.toBe(
      card.fingerprint(j, ctx),
    );
    expect(card.summary(j)).toBe('2 variables · Little’s test · Jamshidian & Jalal');
  });
  it('read Little’s test as a report would', () => {
    expect(littleText(little)).toMatch(
      /^Little’s MCAR test: χ²\(14\) = 35\.15, p = 0\.001, over 4 patterns \(42 of 153 cases incomplete\): the values are not missing completely at random/,
    );
    expect(littleText({ ...little, p: 0.4 })).toMatch(/no evidence against MCAR/);
  });
  it('show the MCAR tab only when a test ran', () => {
    const View = card.View;
    expect(
      renderToStaticMarkup(<View result={result({})} options={card.defaults(ctx)} current />),
    ).not.toContain('MCAR tests');
    expect(
      renderToStaticMarkup(
        <View result={result({ little })} options={card.defaults(ctx)} current />,
      ),
    ).toContain('MCAR tests');
    expect(
      renderToStaticMarkup(
        <View
          result={result({ jamjal: { error: 'no pattern of 6 cases' } })}
          options={card.defaults(ctx)}
          current
        />,
      ),
    ).toContain('MCAR tests');
  });
});
