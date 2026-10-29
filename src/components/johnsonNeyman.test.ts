import { describe, expect, it } from 'vitest';
import type { CbResult } from '../engine/types';
import { boundaryLabels } from './JohnsonNeymanPlot';
import { jnNote } from './results/CbTabs';

describe('Johnson–Neyman plot labels', () => {
  it('puts a label left of its line when the next boundary is too close', () => {
    expect(boundaryLabels([100, 130])).toEqual([{ x: 97, anchor: 'end' }, { x: 133, anchor: 'start' }]);
    expect(boundaryLabels([100, 300])).toEqual([{ x: 103, anchor: 'start' }, { x: 303, anchor: 'start' }]);
    expect(boundaryLabels([100])).toEqual([{ x: 103, anchor: 'start' }]);
    expect(boundaryLabels([])).toEqual([]);
  });
});

describe('Johnson–Neyman note', () => {
  const mo = { from: 'X', moderator: 'Z', to: 'Y', construct: 3 };
  const jn = { quadratic: false, bx: 0.673, bint: 0.718, crit: 1.96 };
  const cb = (interaction?: 'lms' | 'qml') => ({ estimator: 'ML', ...(interaction ? { interaction } : {}) }) as unknown as CbResult;
  it('names the estimation method: product indicators, LMS or QML', () => {
    expect(jnNote(cb(), mo, jn)).toMatch(/^Latent interaction from matched-pair products .* ML parameter covariance; .* Validated against lavaan\.$/);
    const lms = jnNote(cb('lms'), mo, jn);
    expect(lms).toMatch(/^Latent interaction estimated by LMS \(modsem; Klein & Moosbrugger 2000\), without product indicators\./);
    expect(lms).toContain('LMS (modsem) parameter covariance');
    expect(lms).not.toMatch(/matched-pair|lavaan/);
    expect(jnNote(cb('qml'), mo, jn)).toMatch(/QML \(modsem; Klein & Muthén 2007\)/);
    expect(jnNote(cb('lms'), { ...mo, moderator: 'X' }, { ...jn, quadratic: true })).toMatch(/^Latent quadratic term estimated by LMS.*Slope of X at x/);
  });
});
