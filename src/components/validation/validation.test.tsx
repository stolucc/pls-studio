// @vitest-environment happy-dom
// The validation record in the app: the dialog lists what the tests recorded, grouped and graded, with every
// comparison; the results badge of an example holds only while what is estimated is unchanged.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../../model/project';
import { estimationKey } from '../../validation/exampleState';
import { evidenceKinds, resetEvidence } from '../../validation/useEvidence';
import type { Evidence } from '../../validation/types';
import { useStore } from '../../store';
import { ValidationPage } from './ValidationPage';
import { CARD_EVIDENCE } from '../../validation/cards';
import { checkIsFor, coverage } from '../../validation/coverage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evidence: Evidence = {
  generated: '2026-11-03',
  webR: '0.6.0',
  R: '4.6',
  versions: { lavaan: '0.7-3' },
  checks: [
    {
      id: 'mplus-ex5.25',
      subject: 'example',
      title: 'x',
      method: 'CB-SEM',
      level: 'published',
      packages: ['lavaan'],
      passed: true,
      test: 'examples/mplus: ex5.25',
      sources: [{ label: 'Mplus User’s Guide, example 5.25', level: 'published' }],
      comparisons: [
        {
          quantity: 'χ²',
          value: 51.3531,
          reference: 51.353,
          tolerance: 0.002,
          source: 'Mplus User’s Guide, example 5.25',
        },
        { quantity: 'unexpected R warnings and notes', value: 0, reference: 0, tolerance: 0 },
      ],
    },
    {
      id: 'csem-switching',
      subject: 'example',
      title: 'y',
      method: 'PLS-SEM',
      level: 'runs',
      packages: ['cSEM'],
      passed: true,
      test: 'examples/packages',
      sources: [],
      comparisons: [
        { quantity: 'unexpected R warnings and notes', value: 0, reference: 0, tolerance: 0 },
      ],
    },
    {
      id: 'rengine/esem::bifactor',
      subject: 'feature',
      title: 'Exploratory SEM and bifactor rotations: bifactor',
      method: 'CB-SEM',
      level: 'native',
      packages: ['lavaan'],
      passed: true,
      test: 't',
      sources: [{ label: 'desktop lavaan', script: 'scripts/validation/bifactor.R' }],
      comparisons: [{ quantity: 'value 1', value: 0.5, reference: 0.5, tolerance: 5e-5 }],
    },
  ],
};

let host: HTMLDivElement;
beforeEach(() => {
  resetEvidence();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => evidence })),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  vi.unstubAllGlobals();
  host.remove();
});

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('ValidationPage', () => {
  it('summarises the record, groups the examples by method and opens one’s comparisons', async () => {
    act(() => {
      createRoot(host).render(
        <ValidationPage onBack={() => {}} focus="mplus-ex5.25" titles={{}} />,
      );
    });
    await flush();
    const text = host.textContent!;
    expect(text).toContain('4 comparisons in 3 checks, all passed');
    expect(text).toContain('CB-SEM');
    expect(text).toContain('PLS-SEM');
    expect(text).toContain('Reproduces published results');
    // The focused example is open: its comparisons, the reference and what each was compared against.
    expect(text).toContain('51.3531');
    expect(text).toContain('Mplus User’s Guide, example 5.25');
    // The methods tab lists the feature checks.
    act(() => {
      [...host.querySelectorAll('button[role="tab"]')]
        .find((b) => b.textContent === 'Methods')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('Exploratory SEM and bifactor rotations');
  });
});

describe('the Analyses tab', () => {
  const click = (el: Element) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  const tab = (name: string) =>
    [...host.querySelectorAll('button[role="tab"]')].find((b) => b.textContent === name)!;
  const row = (key: string) =>
    [...host.querySelectorAll('.evidence-head')].find((b) => b.textContent!.includes(key))!;
  it('lists every card, mode, Model-tab analysis and built-in part with its evidence, and leads to an example’s check', async () => {
    const withHs: Evidence = {
      ...evidence,
      checks: [
        ...evidence.checks,
        {
          ...evidence.checks[0],
          id: 'lavaan-hs',
          title: 'HS',
          cards: ['model:cbsem:estimator:ML'],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => withHs })),
    );
    act(() => {
      createRoot(host).render(<ValidationPage onBack={() => {}} />);
    });
    await flush();
    click(tab('Analyses'));
    const text = host.textContent!;
    for (const g of ['Analysis cards', 'Model tab', 'Built-in engine']) expect(text).toContain(g);
    expect(text).toContain('Binomial, complementary log-log link');
    expect(text).toContain('regression:binomial:cloglog');
    expect(host.querySelectorAll('.evidence-row').length).toBe(Object.keys(CARD_EVIDENCE).length);
    // ESEM's method check is in the record; the cloglog test is newer than it.
    expect(row('model:cbsem:esem').textContent).toContain('1 check, 1 compared; 2 pending');
    expect(row('regression:binomial:cloglog').textContent).toContain(
      'evidence pending regeneration',
    );
    expect(row('snapshot').textContent).toContain('No statistics');
    // Search, then open an entry and follow its example to the Examples tab, opened at its check.
    const search = host.querySelector('input[aria-label="Search analyses"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'estimator:ML',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.evidence-row').length).toBeLessThan(5);
    click(row('model:cbsem:estimator:ML'));
    const link = [...host.querySelectorAll('button.linkish')].find(
      (b) => b.textContent === 'lavaan-hs' || b.closest('li')!.textContent!.includes('(lavaan-hs)'),
    )!;
    click(link);
    expect(tab('Examples').getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.evidence-row.open')!.textContent).toContain('51.3531');
  });

  it('matches checks by the card ids they carry and by the manifest’s references', () => {
    const e = CARD_EVIDENCE['model:cbsem:esem'];
    expect(checkIsFor('model:cbsem:esem', e, evidence.checks[2])).toBe(true);
    expect(checkIsFor('model:cbsem:esem', e, evidence.checks[0])).toBe(false);
    expect(
      checkIsFor('model:cbsem:esem', e, { ...evidence.checks[0], cards: ['model:cbsem:esem'] }),
    ).toBe(true);
    const rows = coverage(null, ['run', 'regression'], () => 'T');
    expect(rows.map((r) => r.key).slice(0, 2)).toEqual(['run', 'regression']);
    expect(rows.find((r) => r.key === 'regression:gamma')).toMatchObject({
      mode: true,
      group: 'cards',
      checks: [],
      pending: ['stats-clotting'],
    });
    expect(rows.find((r) => r.key === 'builtin:stats')!.group).toBe('builtin');
  });
});

describe('ValidationPage without a record', () => {
  it('says the record is not available (a missing file: the dev server answers with its HTML page)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new Error('not JSON');
        },
      })),
    );
    act(() => {
      createRoot(host).render(<ValidationPage onBack={() => {}} />);
    });
    await flush();
    expect(host.textContent).toContain(
      'The validation record is not available in this copy of PLS Studio yet.',
    );
    expect(host.textContent).not.toContain('Loading the validation record');
    // The analyses and the evidence each should have still show, from the manifest.
    expect(host.textContent).toContain('Analysis cards');
    expect(host.textContent).toContain('evidence pending regeneration');
  });
});

describe('evidenceKinds', () => {
  it('lists every kind of evidence an example was compared with, not just one; runs when none', () => {
    const both = {
      ...evidence.checks[0],
      sources: [
        { label: 'book', level: 'published' as const },
        { label: 'desktop lavaan', level: 'native' as const },
        { label: 'unused', level: 'native' as const },
      ],
      comparisons: [
        { quantity: 'χ²', value: 1, reference: 1, tolerance: 0.01, source: 'book' },
        { quantity: 'x', value: 1, reference: 1, tolerance: 1e-4, source: 'desktop lavaan' },
      ],
    };
    expect(evidenceKinds(both)).toEqual(['published', 'native']);
    expect(evidenceKinds({ ...both, comparisons: [both.comparisons[0]] })).toEqual(['published']);
    expect(evidenceKinds(evidence.checks[1])).toEqual(['runs']);
    expect(evidenceKinds(evidence.checks[2])).toEqual(['native']); // a method check: its own kind
  });
});

describe('the validation view', () => {
  it('opens at an example and goes back where it was opened from', () => {
    const s = () => useStore.getState();
    s().setView('editor');
    s().openValidation('mplus-ex5.25');
    expect([s().view, s().validationFocus, s().validationReturn]).toEqual([
      'validation',
      'mplus-ex5.25',
      'editor',
    ]);
    s().closeValidation();
    expect([s().view, s().validationFocus]).toEqual(['editor', null]);
    s().setView('home');
    s().openValidation();
    s().closeValidation();
    expect(s().view).toBe('home');
  });
  it('has a back button saying where it goes', async () => {
    let back = 0;
    act(() => {
      createRoot(host).render(
        <ValidationPage
          onBack={() => {
            back++;
          }}
          backLabel="Home"
        />,
      );
    });
    await flush();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '← Home')!;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(back).toBe(1);
  });
});

describe('estimationKey', () => {
  const model: ModelState = {
    constructs: [
      {
        id: 'A',
        name: 'A',
        x: 0,
        y: 0,
        indicators: ['a1', 'a2'],
        mode: 'A',
        type: 'factor',
      } as never,
      {
        id: 'B',
        name: 'B',
        x: 100,
        y: 0,
        indicators: ['b1', 'b2'],
        mode: 'A',
        type: 'factor',
      } as never,
    ],
    paths: [{ id: 'p', from: 'A', to: 'B' }],
    moderations: [],
  };
  it('ignores the layout and the figure, not the model, the estimation settings or the data', () => {
    const k = estimationKey(model, DEFAULT_SETTINGS, 1);
    expect(
      estimationKey(
        { ...model, constructs: model.constructs.map((c) => ({ ...c, x: c.x + 40 })) },
        { ...DEFAULT_SETTINGS, figure: { ...DEFAULT_SETTINGS.figure, fontSize: 30 } },
        1,
      ),
    ).toBe(k);
    expect(estimationKey({ ...model, paths: [] }, DEFAULT_SETTINGS, 1)).not.toBe(k);
    expect(
      estimationKey(model, { ...DEFAULT_SETTINGS, consistent: !DEFAULT_SETTINGS.consistent }, 1),
    ).not.toBe(k);
    expect(estimationKey(model, DEFAULT_SETTINGS, 2)).not.toBe(k);
  });
});
