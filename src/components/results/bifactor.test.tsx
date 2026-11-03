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
