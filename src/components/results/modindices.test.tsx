import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CbResult } from '../../engine/cbsem';
import { CbTab } from './CbTabs';

const html = (cb: Partial<CbResult>) => renderToStaticMarkup(<CbTab tab="modindices" cb={cb as CbResult} boot={null} />);

describe('modification indices tab', () => {
  it('tells apart: not computed, lavaan could not compute them, and none reaching 3.84', () => {
    expect(html({})).toContain('computed by lavaan');
    expect(html({ modindices: [], modindicesError: 'not available for models with composites (<~)' })).toContain('not available for this model. lavaan: not available for models with composites');
    expect(html({ modindices: [] })).toContain('No modification index reaches 3.84');
    expect(html({ modindices: [{ lhs: 'F', op: '=~', rhs: 'x4', mi: 12.5, epc: 0.3, sepc: 0.2 }] })).toContain('F =~ x4');
  });
});
