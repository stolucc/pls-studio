// @vitest-environment happy-dom
// The fit tables' hover help: the text module (an entry for every index both fit tables show,
// citing only known works, in step with the fit guidance), and the tooltip itself (hover, focus,
// Escape, placement).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FitTestResult } from '../../engine/bootstrap';
import type { CbFit, CbResult } from '../../engine/cbsem';
import type { PlsResult } from '../../engine/types';
import { citeText, hasWork } from '../../reporting/citations';
import {
  CB_FIT_ROWS,
  CB_RUN_ROWS,
  DYNAMIC_TEXT,
  FIT_HELP,
  PLS_FIT_ROWS,
  type FitHelpId,
} from '../../reporting/fitHelp';
import { useStore } from '../../store';
import { HelpTip, tipPosition } from '../HelpTip';
import { CbTab } from './CbTabs';
import { PlsTab } from './PlsTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

// Every row the CB-SEM table can show: robust indices, a shift parameter, imputations, ML's AIC/BIC.
const fit: CbFit = {
  chisq: 85.306,
  df: 24,
  pvalue: 0,
  baselineChisq: 918.852,
  baselineDf: 36,
  cfi: 0.931,
  tli: 0.896,
  rmsea: 0.092,
  rmseaLow: 0.071,
  rmseaHigh: 0.114,
  rmseaP: 0.001,
  srmr: 0.065,
  aic: 7535.49,
  bic: 7646.703,
  logl: -3737.745,
  npar: 21,
  chisqScaled: 80.872,
  dfScaled: 24,
  pvalueScaled: 0,
  scalingFactor: 1.055,
  shiftParameter: 1.2,
  baselineChisqScaled: 789.892,
  cfiScaled: 0.925,
  tliScaled: 0.887,
  cfiRobust: 0.93,
  tliRobust: 0.895,
  rmseaScaled: 0.089,
  rmseaRobust: 0.092,
};
const cb = {
  fit,
  estimator: 'MLR',
  n: 301,
  imputations: 5,
  iterations: 30,
  warnings: [],
  estimates: [],
  constructs: [],
  indicators: [],
  moderations: [],
} as unknown as CbResult;

const disc = (srmr: number) => ({ srmr, dULS: 0.3, dG: 0.2 });
const pls = {
  fit: { saturated: disc(0.05), estimated: disc(0.06) },
  moderations: [],
} as unknown as PlsResult;
const fitTest = {
  hi95: { saturated: disc(0.07), estimated: disc(0.07) },
  hi99: { saturated: disc(0.08), estimated: disc(0.08) },
} as unknown as FitTestResult;

/** The first cell of every body row, with whether it has an info button. */
function firstCells() {
  return [...host.querySelectorAll('table.grid tbody tr')].map((tr) => {
    const td = tr.querySelector('td')!;
    return { label: td.textContent ?? '', tip: td.querySelector('.help-tip-btn') !== null };
  });
}

describe('the help text', () => {
  it('cites only works in the reference list, and names every work it cites', () => {
    for (const [id, h] of Object.entries(FIT_HELP)) {
      const text = [h.measures, h.read, h.cutoff, h.caveat, h.dynamic ? DYNAMIC_TEXT : ''].join(
        ' ',
      );
      for (const key of h.sources) {
        expect(hasWork(key), `${id}: ${key}`).toBe(true);
        // The first author's surname appears in the text.
        const surname = citeText(key).split(/[ ,]/)[0];
        expect(text, `${id} cites ${key}`).toContain(surname);
      }
      if (h.dynamic) expect(h.sources).toContain('mcneish2023');
      expect(h.measures).toMatch(/\.$/);
      expect(h.read).toMatch(/\.$/);
    }
  });

  it('every row label maps to an entry; every entry is used', () => {
    const used = new Set<FitHelpId>([
      ...Object.values(CB_FIT_ROWS),
      ...Object.values(PLS_FIT_ROWS),
      'plsTest',
    ]);
    expect([...used].sort()).toEqual(Object.keys(FIT_HELP).sort());
  });

  it('agrees with the fit guidance and the checklist (Hu & Bentler 1999 cutoffs)', () => {
    expect(FIT_HELP.cfi.cutoff).toContain('≥ .95 (Hu & Bentler 1999)');
    expect(FIT_HELP.tli.cutoff).toContain('≥ .95 (Hu & Bentler 1999)');
    expect(FIT_HELP.rmsea.cutoff).toContain('≤ .06 (Hu & Bentler 1999)');
    expect(FIT_HELP.srmr.cutoff).toContain('≤ .08 (Hu & Bentler 1999)');
    // RMSEA with few df (FitGuide's rmsea-low-df note), and the naive scaled indices.
    expect(FIT_HELP.rmsea.caveat).toContain('Kenny, Kaniskan & McCoach 2015');
    expect(FIT_HELP.scaledIncremental.caveat).toContain('do not apply');
    expect(FIT_HELP.rmseaScaled.caveat).toContain('do not apply');
    // PLS-SEM: thresholds not established.
    for (const id of ['plsSrmr', 'plsDuls', 'plsDg', 'plsTest'] as const) {
      expect(FIT_HELP[id].caveat).toContain('not established');
      expect(FIT_HELP[id].sources).toContain('hair2021');
    }
  });
});

describe('the fit tables', () => {
  it('CB-SEM: every index row has an info button; the run rows have none', () => {
    act(() => root.render(<CbTab tab="fit" cb={cb} boot={null} />));
    const cells = firstCells().filter((c) => c.label !== '');
    const labels = cells.map((c) => c.label);
    // (the fixture shows every row the table has)
    expect(labels).toEqual(expect.arrayContaining([...Object.keys(CB_FIT_ROWS), ...CB_RUN_ROWS]));
    for (const c of cells) {
      expect(c.tip, c.label).toBe(!CB_RUN_ROWS.includes(c.label));
    }
  });

  it('PLS-SEM: SRMR, d_ULS and d_G have info buttons, and so has the bootstrap test', () => {
    useStore.setState({ job: null });
    act(() => root.render(<PlsTab tab="fit" pls={pls} boot={null} fitTest={fitTest} />));
    const cells = firstCells();
    expect(cells.map((c) => c.label)).toEqual(['SRMR', 'd_ULS', 'd_G', 'SRMR', 'd_ULS', 'd_G']);
    expect(cells.every((c) => c.tip)).toBe(true);
    const heading = [...host.querySelectorAll('h3')].find((h) =>
      h.textContent?.includes('Test of overall model fit'),
    )!;
    const button = heading.querySelector('.help-tip-btn') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe(`About ${FIT_HELP.plsTest.title}`);
  });
});

describe('the tooltip', () => {
  const tooltip = () => document.querySelector('[role="tooltip"]');
  const render = () =>
    act(() =>
      root.render(
        <HelpTip label="CFI">
          <p>Help on CFI.</p>
        </HelpTip>,
      ),
    );
  const trigger = () => host.querySelector('.help-tip-btn') as HTMLButtonElement;

  it('opens on hover and closes shortly after the pointer leaves', () => {
    vi.useFakeTimers();
    render();
    expect(tooltip()).toBeNull();
    act(() => trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(tooltip()?.textContent).toBe('Help on CFI.');
    expect(trigger().getAttribute('aria-describedby')).toBe(tooltip()!.id);
    act(() => trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(tooltip()).not.toBeNull(); // (time to move onto the tooltip)
    act(() => vi.advanceTimersByTime(200));
    expect(tooltip()).toBeNull();
  });

  it('stays open while the pointer is on the tooltip', () => {
    vi.useFakeTimers();
    render();
    act(() => trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    act(() => trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    act(() => tooltip()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    act(() => vi.advanceTimersByTime(500));
    expect(tooltip()).not.toBeNull();
  });

  it('opens on keyboard focus, closes on Escape and on blur', () => {
    render();
    act(() => trigger().focus());
    expect(tooltip()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(tooltip()).toBeNull();
    expect(document.activeElement).toBe(trigger()); // (focus stays on the button)
    act(() => trigger().click());
    expect(tooltip()).not.toBeNull();
    act(() => trigger().blur());
    expect(tooltip()).toBeNull();
  });

  it('is placed below the button, above it when there is no room, inside the window', () => {
    const view = { width: 800, height: 600 };
    const size = { width: 340, height: 200 };
    expect(tipPosition({ left: 100, top: 100, bottom: 118 }, size, view)).toEqual({
      left: 100,
      top: 124,
    });
    expect(tipPosition({ left: 100, top: 500, bottom: 518 }, size, view)).toEqual({
      left: 100,
      top: 294,
    });
    expect(tipPosition({ left: 700, top: 100, bottom: 118 }, size, view).left).toBe(452);
  });
});
