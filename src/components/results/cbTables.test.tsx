import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CbResult } from '../../engine/cbsem';
import { CbTab } from './CbTabs';

const base: Partial<CbResult> = { constructs: ['g', 'verbal', 'fluency'], reliability: [{ cr: NaN, ave: NaN }, { cr: 0.8, ave: 0.6 }, { cr: 0.7, ave: 0.5 }] };
const html = (cb: Partial<CbResult>) => renderToStaticMarkup(<CbTab tab="reliability" cb={{ ...base, ...cb } as CbResult} boot={null} />);

describe('reliability tab, bifactor ESEM', () => {
  it('shows ECV, omega and omega hierarchical of the total score and each subscale, only with a bifactor block', () => {
    expect(html({})).not.toContain('Bifactor indices');
    const out = html({ bifactor: [{ general: 'g', items: 6, ecv: 0.659, omega: 0.933, omegaH: 0.789,
      specific: [{ factor: 'verbal', omega: 0.933, omegaHS: 0.064, items: 3 }, { factor: 'fluency', omega: 0.827, omegaHS: 0.427, items: 3 }] }] });
    expect(out).toContain('Bifactor indices: general factor g');
    expect(out).toContain('Reliability and convergent validity');
    for (const v of ['0.659', '0.933', '0.789', '0.064', '0.427']) expect(out).toContain(v);
  });
});

describe('variances tab, TECH4', () => {
  it('lists the implied means and every pair of latent variables, without SEs where held fixed', () => {
    const vt = (cb: Partial<CbResult>) => renderToStaticMarkup(<CbTab tab="variances" cb={{ estimates: [], ...cb } as CbResult} boot={null} />);
    expect(vt({})).not.toContain('TECH4');
    const out = vt({ tech4: { names: ['visual', 'speed'], mean: [0, -0.177], meanSe: [null, 0.0901],
      cov: [[0.8, 0.33], [0.33, 0.505]], covSe: [[0.14, 0.082], [0.082, 0.115]], cor: [[1, 0.55], [0.55, 1]], corSe: [[null, 0.094], [0.094, null]] } });
    expect(out).toContain('Implied latent means (TECH4)');
    expect(out).toContain('visual ↔ speed');
    for (const v of ['0.505', '0.550', '0.094', '0.090']) expect(out).toContain(v);
  });
});
