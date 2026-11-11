// The Meta-analysis card without R: options from files, why it cannot run, staleness, the request it sends (roles,
// labels from a text column, the back-transformation a measure implies), factor terms' labels, and what the view shows.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { measureTransf, metaRequest, type MetaResult } from '../rengine/meta';
import { metaAnalysis as meta, metaInput, termLabel, type MetaOptions } from './meta';
import { niceTicks } from './metaCharts';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const names = ['study', 'tpos', 'tneg', 'cpos', 'cneg', 'ablat', 'alloc', 'yi', 'vi'];
const data = {
  names,
  cols: names.map((_, k) => col(1 + k, 2 + k, 3 + k)),
  categories: { study: ['Aronson', 'Ferguson', 'Rosenthal'], alloc: ['alternate', 'random'] },
};
const ctx: AnalysisCtx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};
const rr: MetaOptions = {
  ...meta.defaults(ctx),
  measure: 'RR',
  columns: { ai: 'tpos', bi: 'tneg', ci: 'cpos', di: 'cneg' },
};

describe('the Meta-analysis card', () => {
  it('validates saved options strictly', () => {
    expect(
      meta.parseOptions({
        measure: 'XX',
        columns: { yi: 'es', evil: 'x', vi: 7 },
        method: 'nope',
        moderators: ['a', 'b', 3],
        categorical: ['b', 'c'],
        knha: 'yes',
        bias: true,
      }),
    ).toEqual({
      ...meta.defaults(ctx),
      columns: { yi: 'es' },
      moderators: ['a', 'b'],
      categorical: ['b'],
      knha: false,
      bias: true,
    });
    expect(meta.parseOptions({ measure: 'SMD', method: 'PM', transf: 'ztor' })).toMatchObject({
      measure: 'SMD',
      method: 'PM',
      transf: 'ztor',
    });
    expect(meta.parseOptions(null)).toBeNull();
  });

  it('says why it cannot run', () => {
    expect(meta.blocked(meta.defaults(ctx), ctx)).toBe(
      'Choose the columns: Effect size, Sampling variance.',
    );
    expect(meta.blocked(rr, ctx)).toBeNull();
    expect(meta.blocked({ ...rr, columns: { ...rr.columns, di: 'tpos' } }, ctx)).toBe(
      'Each summary-data column must be a different column.',
    );
    expect(meta.blocked({ ...rr, moderators: ['tpos'] }, ctx)).toContain('Moderators must be');
    expect(meta.blocked({ ...rr, cluster: 'study', method: 'DL' }, ctx)).toContain('REML or ML');
    expect(meta.blocked({ ...rr, cluster: 'study' }, ctx)).toBeNull();
    expect(meta.blocked({ ...rr, label: 'nope' }, ctx)).toBe('Not in the data: nope.');
    expect(meta.blocked(rr, { ...ctx, data: null })).toContain('needs raw data');
  });

  it('is stale when the columns, the model or the confidence level change', () => {
    const fp = meta.fingerprint(rr, ctx);
    expect(fp).toBeTruthy();
    expect(meta.fingerprint({ ...rr, method: 'DL' }, ctx)).not.toBe(fp);
    expect(meta.fingerprint({ ...rr, moderators: ['ablat'] }, ctx)).not.toBe(fp);
    const ctx99 = { ...ctx, settings: { ...DEFAULT_SETTINGS, confidence: 0.99 } };
    expect(meta.fingerprint(rr, ctx99)).not.toBe(fp);
    expect(meta.summary({ ...rr, moderators: ['ablat'], cluster: 'study' })).toBe(
      'Log risk ratio · random effects (REML) · moderators: ablat · three-level by study',
    );
  });

  it('sends the roles of the measure, the labels as text and the implied back-transformation', () => {
    const req = metaRequest(data, metaInput({ ...rr, label: 'study', moderators: ['ablat'] }, ctx));
    expect(req.columns).toEqual({ ai: 'tpos', bi: 'tneg', ci: 'cpos', di: 'cneg' });
    expect(req.transf).toBe('exp');
    expect(req.labels).toEqual(['Aronson', 'Ferguson', 'Rosenthal']);
    expect(req.data.names).toEqual(['tpos', 'tneg', 'cpos', 'cneg', 'ablat']);
    expect(req).not.toHaveProperty('cluster');
    // (given effect sizes: the second column is the variance or the SE, and the scale is the user's)
    const gen = metaRequest(
      data,
      metaInput(
        {
          ...meta.defaults(ctx),
          varType: 'sei',
          columns: { yi: 'yi', sei: 'vi', vi: 'ablat' },
          transf: 'ilogit',
        },
        ctx,
      ),
    );
    expect(gen.columns).toEqual({ yi: 'yi', sei: 'vi' });
    expect(gen.transf).toBe('ilogit');
    expect(measureTransf('ZCOR', 'none')).toBe('ztor');
    expect(measureTransf('SMD', 'exp')).toBe('none');
  });

  it('labels factor terms by their categories', () => {
    expect(termLabel('factor(alloc)2', data.categories)).toBe('alloc: random');
    expect(termLabel('factor(year)1980')).toBe('year = 1980');
    expect(termLabel('ablat')).toBe('ablat');
  });

  it('chooses round axis ticks', () => {
    expect(niceTicks(-1.62, 0.45)).toEqual([-1.5, -1, -0.5, 0]);
    expect(niceTicks(0, 0.6, 4)).toEqual([0, 0.2, 0.4, 0.6]);
  });

  it('shows the pooled estimate, the forest and funnel plots, heterogeneity and bias', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const study = (label: string, yi: number) => ({
      label,
      yi,
      vi: 0.1,
      ciLow: yi - 0.6,
      ciHigh: yi + 0.6,
      weight: 50,
    });
    const test = {
      stat: -0.8,
      df: null,
      p: 0.42,
      est: -0.51,
      estSe: 0.31,
      estP: 0.1,
      ciLow: -1.1,
      ciHigh: 0.1,
    };
    const r: MetaResult & { input: ReturnType<typeof metaInput> } = {
      measure: 'RR',
      method: 'REML',
      knha: false,
      threeLevel: false,
      k: 2,
      studies: [study('Aronson', -0.89), study('Ferguson', -1.59)],
      coefs: [
        {
          term: 'intrcpt',
          est: -0.7145,
          se: 0.18,
          stat: -3.97,
          df: null,
          p: 0.0001,
          ciLow: -1.07,
          ciHigh: -0.36,
        },
      ],
      pooled: { est: -0.7145, se: 0.18, ciLow: -1.07, ciHigh: -0.36, piLow: -1.87, piHigh: 0.44 },
      pooledBack: { est: 0.489, se: null, ciLow: 0.344, ciHigh: 0.696, piLow: 0.155, piHigh: 1.55 },
      Q: 152.23,
      Qdf: 12,
      Qp: 0,
      QM: null,
      QMdf: [],
      QMp: null,
      heterogeneity: { tau2: 0.3132, tau2se: 0.166, I2: 92.22, H2: 12.86, ci: undefined },
      fit: { logLik: -12.6, deviance: 25.2, AIC: 29.2, BIC: 30.3, AICc: 30.5 },
      bias: {
        egger: test,
        rank: { tau: 0.026, p: 0.95 },
        trimfill: {
          k0: 1,
          side: 'right',
          est: -0.657,
          se: 0.179,
          p: 0.0002,
          ciLow: -1.01,
          ciHigh: -0.31,
          tau2: 0.33,
          filled: [{ yi: 0.31, vi: 0.2 }],
        },
        pet: { ...test, df: 11 },
        peese: { ...test, df: 11, estP: 0.03 },
      },
      warnings: [],
      engine: { package: 'metafor', version: '5.2.1' },
      input: metaInput(rr, ctx),
    };
    const html = renderToStaticMarkup(<meta.View result={r} options={rr} current />);
    expect(html).toContain('Forest plot');
    expect(html).toContain('Funnel plot');
    expect(html).toContain('Aronson');
    expect(html).toContain('0.489');
    expect(html).toContain('a ratio (exp)');
    expect(html).toContain('Trim-and-fill (1 added on the right)');
    expect(html).toContain('PET is the corrected estimate');
    expect(html).toContain('Random-effects model');
  });
});
