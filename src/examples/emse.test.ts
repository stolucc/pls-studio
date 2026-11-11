import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { mcIndirect } from '../engine/mcci';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  toSpec,
  validateModel,
} from '../model/project';
import { makeEmseExample } from './emse';
import { parseCovMatrixCsv, parseNacovCsv } from './matrix';

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'validation', 'emse_sem_mlm.json'),
    'utf8',
  ),
).expected;

describe('Stol et al. (2022) example', () => {
  const ex = makeEmseExample(DEFAULT_SETTINGS);

  it('is a valid CB-SEM project on matrix data', () => {
    expect(ex.settings.method).toBe('cbsem');
    expect(ex.settings.estimator).toBe('MLM');
    expect(
      validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
    ).toEqual([]);
    expect(
      validateModel(ex.model, ex.data, { ...ex.settings, method: 'pls' }).some((i) =>
        i.message.includes('covariance matrix'),
      ),
    ).toBe(true);
  });

  it('reproduces the published MLM results (lavaan)', () => {
    const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'MLM');
    expect(cb.fit.chisq).toBeCloseTo(ref.fit.chisq, 4);
    expect(cb.fit.df).toBe(89);
    expect(cb.fit.chisqScaled!).toBeCloseTo(ref.fit['chisq.scaled'], 4);
    expect(cb.fit.cfiRobust!).toBeCloseTo(ref.fit['cfi.robust'], 5);
    expect(cb.fit.rmseaRobust!).toBeCloseTo(ref.fit['rmsea.robust'], 5);
    const r2 = (name: string) => cb.r2Constructs[cb.constructs.indexOf(name)];
    expect(r2('Job satisfaction')).toBeCloseTo(ref.r2.js, 5);
    expect(r2('Engagement')).toBeCloseTo(ref.r2.engag, 5);
    const ind = mcIndirect(cb, 1000, 1).find(
      (x) => x.from === 'Participation' && x.to === 'Job satisfaction',
    )!;
    expect(ind.est).toBeCloseTo(ref.indirectUnstd[0].est, 6);
  });

  it('round-trips through a project file, matrices included', () => {
    const p = parseProject(serializeProject(ex.model, ex.settings, ex.data, ex.info));
    expect(p.data!.moments!.n).toBe(155);
    expect(p.data!.moments!.nacov!.length).toBe(136);
    expect(p.info!.kind).toBe('matrix');
    expect(p.model.constructs.find((c) => c.name === 'Engagement')!.components).toHaveLength(2);
    expect(p.model.constructs.filter((c) => c.covariate).map((c) => c.name)).toEqual([
      'age',
      'ismale',
      'tenure_s',
    ]);
  });
});

describe('matrix input parsing', () => {
  it('detects labelled symmetric matrices and rejects raw data', () => {
    expect(parseCovMatrixCsv('"","a","b"\n"a",2,0.5\n"b",0.5,1\n')).toEqual({
      names: ['a', 'b'],
      S: [
        [2, 0.5],
        [0.5, 1],
      ],
    });
    expect(parseCovMatrixCsv('a,b\n1,2\n3,4\n5,6\n')).toBeNull();
    expect(parseCovMatrixCsv('"","a","b"\n"a",2,0.4\n"b",0.5,1\n')).toBeNull(); // not symmetric
  });
  it('checks NACOV dimensions', () => {
    expect(() => parseNacovCsv('1,0\n0,1\n', 2)).toThrow(/3 × 3/);
  });
  it('rejects malformed matrices in project files', () => {
    const ex = makeEmseExample(DEFAULT_SETTINGS);
    const f = JSON.parse(serializeProject(ex.model, ex.settings, ex.data, ex.info));
    f.data.moments.S[0][1] = 999;
    expect(() => parseProject(JSON.stringify(f))).toThrow(/symmetric/);
    f.data.moments.S[0][1] = f.data.moments.S[1][0];
    f.data.moments.n = 2;
    expect(() => parseProject(JSON.stringify(f))).toThrow(/N must be/);
  });
});
