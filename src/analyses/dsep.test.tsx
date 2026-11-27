// The implied-independencies card (dsep.tsx): what blocks it and how it reports the claims.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { DsepResult } from '../rengine/dsep';
import { dsepAnalysis as dsep, dsepInput } from './dsep';
import type { AnalysisCtx } from './types';

const obs = (name: string) => ({
  id: name,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [name],
  x: 0,
  y: 0,
  side: 'left' as const,
});
const col = (...v: number[]) => Float64Array.from(v);
const ctx = (model: ModelState): AnalysisCtx => ({
  data: { names: ['a', 'b', 'c'], cols: [col(1, 2, 3), col(2, 1, 3), col(3, 3, 1)] },
  info: null,
  settings: { ...DEFAULT_SETTINGS, method: 'cbsem' },
  pls: null,
  projectName: 'p',
  model,
});
const chain = {
  constructs: ['a', 'b', 'c'].map(obs),
  paths: [
    { id: 'p1', from: 'a', to: 'b' },
    { id: 'p2', from: 'b', to: 'c' },
  ],
  moderations: [],
} as ModelState;

const result: DsepResult = {
  n: 100,
  claims: [
    {
      x: 'a',
      y: 'c',
      given: ['b'],
      r: 0.3,
      t: 3.1,
      df: 97,
      p: 0.0025,
      lower: 0.11,
      upper: 0.47,
      holm: 0.0025,
    },
  ],
  fisherC: 11.98,
  fisherDf: 2,
  fisherP: 0.0025,
  warnings: [],
  engine: { package: 'stats', version: '4.6.2' },
};

describe('implied independencies card', () => {
  it('sends the model’s variables and its basis set, and is blocked without one', () => {
    expect(dsepInput(ctx(chain))).toEqual({
      variables: ['a', 'b', 'c'],
      claims: [{ x: 'a', y: 'c', given: ['b'] }],
    });
    expect(dsep.blocked!({}, ctx(chain))).toBeNull();
    const joined = { ...chain, paths: [...chain.paths, { id: 'p3', from: 'a', to: 'c' }] };
    expect(dsep.blocked!({}, ctx(joined))).toMatch(/implies no independencies/);
    const latent = { ...chain, constructs: [{ ...obs('a'), indicators: ['a', 'b'] }, obs('c')] };
    expect(dsep.blocked!({}, ctx(latent))).toMatch(/recursive path models/);
  });

  it('lists each claim with its test and names the rejected ones', () => {
    const html = renderToStaticMarkup(<dsep.View result={result} options={{}} current />);
    expect(html).toContain('c ⫫ a');
    expect(html).toContain('Fisher’s C = 11.98 on 2 df');
    expect(html).toContain('Rejected after Holm’s correction: c ⫫ a');
  });
});
