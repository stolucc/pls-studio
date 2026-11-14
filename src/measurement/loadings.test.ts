// The loading triage's rules (Hair, Hult, Ringle & Sarstedt 2017, 2021) and their edge cases,
// the model without an indicator, and the re-estimation through the built-in engine against
// plain seminr and cSEM runs with that indicator removed (scripts/validation/loading_triage.R,
// recorded). The R packages' own path is checked in loadingTriage.webr.test.ts.

import { describe, expect, it } from 'vitest';
import { estimatePls } from '../engine/pls';
import { toSpec, type ModelState } from '../model/project';
import { near } from '../validation/record';
import {
  corpRep,
  fixture,
  mobi,
  REFERENCE_OPTIONS,
  type TriageFixture,
  type TriageFixtureRun,
} from './__fixtures__/data';
import {
  AVE_MIN,
  canRemove,
  deletionReason,
  LOADING_DELETE,
  LOADING_KEEP,
  loadingBand,
  reestimationCandidates,
  removalDecision,
  RHOC_MIN,
  triageItems,
  withoutIndicator,
  type TriageItem,
} from './loadings';
import { qualityOf, reestimateRemovals, usesR } from './reestimate';
import { DEFAULT_SETTINGS } from '../model/project';

const ref = fixture<TriageFixture>('loading_triage.json');

describe('loading bands', () => {
  it('uses Hair et al.’s cut-offs 0.40 and 0.70', () => {
    expect(LOADING_DELETE).toBe(0.4);
    expect(LOADING_KEEP).toBe(0.7);
    expect(AVE_MIN).toBe(0.5);
    expect(RHOC_MIN).toBe(0.7);
  });

  it('below 0.40 is a candidate for deletion; 0.40 itself is not', () => {
    expect(loadingBand(0.3999)).toBe('delete');
    expect(loadingBand(-0.8)).toBe('delete');
    expect(loadingBand(0.4)).toBe('consider');
  });

  it('0.40 to below 0.70 is conditional; 0.70 itself is kept', () => {
    expect(loadingBand(0.6999)).toBe('consider');
    expect(loadingBand(0.7)).toBe('keep');
    expect(loadingBand(0.95)).toBe('keep');
  });
});

describe('removal decision (0.40–0.70)', () => {
  const q = (ave: number, rhoC: number) => ({ ave, rhoA: 0.8, rhoC });

  it('is supported when removal lifts AVE to 0.50, or ρC to 0.70, from below', () => {
    expect(removalDecision(q(0.48, 0.82), q(0.54, 0.82)).outcome).toBe('supported');
    expect(removalDecision(q(0.48, 0.82), q(0.5, 0.82)).outcome).toBe('supported');
    expect(removalDecision(q(0.55, 0.68), q(0.56, 0.7)).outcome).toBe('supported');
    expect(removalDecision(q(0.45, 0.65), q(0.52, 0.72)).why).toContain('AVE from 0.45 to 0.52');
  });

  it('is not needed when the construct already meets both thresholds', () => {
    const d = removalDecision(q(0.5, 0.7), q(0.6, 0.8));
    expect(d.outcome).toBe('notNeeded');
    expect(d.why).toMatch(/^Keep/);
  });

  it('is not supported when removal does not reach a threshold', () => {
    expect(removalDecision(q(0.4, 0.82), q(0.4999, 0.83)).outcome).toBe('notSupported');
    expect(removalDecision(q(0.55, 0.6), q(0.58, 0.6999)).outcome).toBe('notSupported');
  });

  it('is not supported when lifting one criterion breaks the other', () => {
    // AVE lifted to .52, but ρC falls below .70, which it met before
    expect(removalDecision(q(0.48, 0.71), q(0.52, 0.69)).outcome).toBe('notSupported');
  });
});

describe('triage items', () => {
  const { data, model } = mobi();
  const pls = estimatePls(data, toSpec(model), REFERENCE_OPTIONS);
  const items = triageItems(model, pls);

  it('covers the Mode A indicators of multi-item constructs only', () => {
    expect(items.map((x) => x.indicator)).not.toContain('CUSCO'); // single item
    expect(items.length).toBe(23);
    const cusl2 = items.find((x) => x.indicator === 'CUSL2')!;
    expect(cusl2.band).toBe('delete');
    expect(items.find((x) => x.indicator === 'CUEX3')!.band).toBe('consider');
    expect(items.find((x) => x.indicator === 'PERV1')!.band).toBe('keep');
    expect(cusl2.before.ave).toBe(pls.quality[pls.constructs.indexOf('Loyalty')].ave);
  });

  it('re-estimates loadings below 0.70 that leave at least two indicators', () => {
    const c = reestimationCandidates(items).map((x) => x.indicator);
    expect(c).toEqual(['IMAG2', 'IMAG3', 'CUEX2', 'CUEX3', 'PERQ2', 'CUSL2']);
    expect(canRemove({ blockSize: 2 })).toBe(false);
    expect(canRemove({ blockSize: 3 })).toBe(true);
  });

  it('leaves out Mode B constructs', () => {
    const cr = corpRep();
    const r = estimatePls(cr.data, toSpec(cr.model), REFERENCE_OPTIONS);
    const names = new Set(triageItems(cr.model, r).map((x) => x.construct));
    expect([...names]).toEqual(['COMP', 'LIKE', 'CUSL']);
  });
});

describe('the model without an indicator', () => {
  const base: ModelState = {
    constructs: [
      {
        id: 'k',
        name: 'K',
        type: 'factor',
        mode: 'A',
        indicators: ['a', 'b', 'c'],
        x: 0,
        y: 0,
        side: 'left',
        dominant: 'b',
        predefinedWeights: { a: 1, b: 1, c: 1 },
      },
      {
        id: 'm',
        name: 'M',
        type: 'factor',
        mode: 'A',
        indicators: ['b', 'd'],
        x: 0,
        y: 0,
        side: 'left',
      },
    ],
    paths: [],
    moderations: [],
  };

  it('drops it from that construct only, with what named it there', () => {
    const m = withoutIndicator(base, 'k', 'b');
    expect(m.constructs[0].indicators).toEqual(['a', 'c']);
    expect(m.constructs[0].dominant).toBeUndefined();
    expect(m.constructs[0].predefinedWeights).toEqual({ a: 1, c: 1 });
    expect(m.constructs[1].indicators).toEqual(['b', 'd']);
    expect(base.constructs[0].indicators).toEqual(['a', 'b', 'c']); // not mutated
  });
});

describe('deletion reasons', () => {
  const item = (loading: number): TriageItem => ({
    constructId: 'k',
    construct: 'K',
    indicator: 'x',
    loading,
    band: loadingBand(loading),
    blockSize: 4,
    factor: true,
    before: { ave: 0.45, rhoA: 0.7, rhoC: 0.68 },
  });
  it('names the rule that applied', () => {
    expect(deletionReason(item(0.31))).toBe('Loading 0.31, below 0.40 (Hair et al. 2017, 2021).');
    expect(deletionReason(item(0.6), { ave: 0.53, rhoA: 0.72, rhoC: 0.73 })).toBe(
      'Loading 0.60, between 0.40 and 0.70; removal raised AVE to 0.53 and ρC to 0.73 (Hair et al. 2017, 2021).',
    );
    expect(deletionReason(item(0.6))).toBe('Loading 0.60; deleted by the author.');
  });
});

/** Compare a re-estimated construct with the recorded seminr and cSEM runs. */
function compare(run: TriageFixtureRun, construct: string, got: ReturnType<typeof qualityOf>) {
  expect(got, construct).not.toBeNull();
  const s = run.seminr[construct];
  // The built-in engine and the packages iterate to 1e-10: they agree far below the printed digits.
  near(`${run.removed} removed: ${construct} AVE vs seminr`, got!.ave, s.ave, 1e-8);
  near(`${run.removed} removed: ${construct} ρC vs seminr`, got!.rhoC, s.rhoC, 1e-8);
  near(`${run.removed} removed: ${construct} ρA vs seminr`, got!.rhoA, s.rhoA, 1e-8);
  const c = run.cSEM[construct];
  near(`${run.removed} removed: ${construct} AVE vs cSEM`, got!.ave, c.ave!, 1e-8);
  near(`${run.removed} removed: ${construct} ρC vs cSEM`, got!.rhoC, c.rhoC!, 1e-8);
}

describe('re-estimating without each candidate (built-in engine) equals seminr and cSEM', () => {
  it.each([
    ['mobi', mobi, ref.mobi],
    ['corporate reputation', corpRep, ref.corprep],
  ] as const)('%s', async (_name, load, runs) => {
    const { data, model } = load();
    const estimate = (spec: ReturnType<typeof toSpec>) =>
      Promise.resolve(estimatePls(data, spec, REFERENCE_OPTIONS));
    const full = await estimate(toSpec(model));
    const items = triageItems(model, full);
    // The full model first: the "before" values.
    for (const item of items) compare(runs[0], item.construct, item.before);
    const wanted = runs.slice(1).map((r) => r.removed);
    const chosen = wanted.map((w) => items.find((x) => x.indicator === w)!);
    const progress: number[] = [];
    const done = await reestimateRemovals(model, chosen, estimate, (d) => progress.push(d));
    expect(progress).toEqual([0, ...chosen.map((_, i) => i + 1)]);
    done.forEach((r, i) => {
      const run = runs[i + 1];
      expect(r.indicator).toBe(run.removed);
      compare(run, chosen[i].construct, r.after);
    });
  });

  it('stops between runs when cancelled and reports a failing run', async () => {
    const { data, model } = mobi();
    const full = estimatePls(data, toSpec(model), REFERENCE_OPTIONS);
    const chosen = reestimationCandidates(triageItems(model, full));
    let calls = 0;
    const done = await reestimateRemovals(
      model,
      chosen,
      () => {
        calls++;
        return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(full);
      },
      () => {},
      () => calls >= 2,
    );
    expect(done).toHaveLength(2);
    expect(done[0].error).toBe('boom');
    expect(done[0].after).toBeNull();
    expect(done[1].after).not.toBeNull();
  });

  it('follows the Model tab’s engine choice', () => {
    const { model } = mobi();
    const spec = toSpec(model);
    expect(usesR(spec, { ...DEFAULT_SETTINGS, engine: 'r' })).toBe(true);
    expect(usesR(spec, { ...DEFAULT_SETTINGS, engine: 'builtin' })).toBe(false);
    expect(usesR({ ...spec, weights: 'w' }, { ...DEFAULT_SETTINGS, engine: 'r' })).toBe(false);
  });
});
