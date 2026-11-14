// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CbEstimate, CbResult } from '../../engine/cbsem';
import { cbResult } from '../../reporting/fixtures';
import { AdmissibilityPanel, WarningList } from './Admissibility';
import { CbTab } from './CbTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const negative: CbEstimate = {
  kind: 'residual',
  lhs: 'x3',
  op: '~~',
  rhs: 'x3',
  est: -0.05,
  se: 0.02,
  z: -2.5,
  p: 0.01,
  std: -0.06,
};

describe('the Admissibility section', () => {
  it('shows a green badge for an admissible solution', () => {
    const html = renderToStaticMarkup(<AdmissibilityPanel cb={cbResult()} />);
    expect(html).toContain('Admissible');
    expect(html).toContain('adm-badge good');
    expect(html).toContain('every variance is positive');
  });

  it('names the parameter, the severity and the likely causes of an improper solution', () => {
    const cb: CbResult = { ...cbResult(), estimates: [...cbResult().estimates, negative] };
    const html = renderToStaticMarkup(<AdmissibilityPanel cb={cb} />);
    expect(html).toContain('Not admissible');
    expect(html).toContain('adm-badge bad');
    expect(html).toContain('Negative residual variance of x3');
    expect(html).toContain('Likely causes, most likely first');
    expect(html).toContain('A misspecified model');
    expect(html).toContain('Kolenikov &amp; Bollen (2012)');
  });

  it('is on the Model fit tab, above the fit statistics', () => {
    const html = renderToStaticMarkup(<CbTab tab="fit" cb={cbResult()} boot={null} />);
    expect(html.indexOf('Admissibility')).toBeGreaterThan(-1);
    expect(html.indexOf('Admissibility')).toBeLessThan(html.indexOf('Fit statistics'));
  });
});

describe('warning explanations', () => {
  it('opens an on-theme explanation from a known warning; an unknown one stays verbatim, without a button', () => {
    // (no native dialog: window.alert would be called otherwise)
    const alert = vi.fn();
    window.alert = alert;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const known = 'lavaan->lav_object_post_check(): some estimated ov variances are negative';
    const unknown = 'lavaan WARNING: something unusual';
    act(() => root.render(<WarningList warnings={[known, unknown]} />));
    const rows = host.querySelectorAll('.issue.warning');
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toBe(unknown);
    expect(rows[1].querySelector('button')).toBeNull();
    act(() => (rows[0].querySelector('button') as HTMLButtonElement).click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Negative residual variance (a Heywood case)');
    expect(dialog.textContent).toContain('What to check');
    expect(dialog.textContent).toContain('What to do');
    expect(alert).not.toHaveBeenCalled();
    act(() =>
      (
        [...dialog.querySelectorAll('button')].find(
          (b) => b.textContent === 'Close',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });
});
