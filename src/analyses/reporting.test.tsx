// The reporting cards: in the Add menu, what they need before they run, when they go stale, what a run reads (the
// current results, the other cards of the log, the browser R session's versions) and the views. The texts themselves:
// src/reporting/*.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useR } from '../rengine/status';
import { cbInput, plsBoot, plsInput, plsResult } from '../reporting/fixtures';
import { ANALYSIS_TYPES } from './registry';
import { checklistAnalysis, checklistText, methodsAnalysis, reportInput } from './reporting';
import { resultsKey, useStore } from '../store';
import { currentCtx, useAnalyses } from './store';
import type { AnalysisCtx } from './types';

const base = plsInput();
const ctx: AnalysisCtx = {
  data: null,
  info: base.info,
  settings: base.settings,
  pls: plsResult(),
  cb: null,
  boot: plsBoot(),
  process: null,
  invariance: null,
  miiv: null,
  projectName: 'p',
  model: base.model,
  resultsKey: 'k1',
};

describe('methods text card', () => {
  beforeEach(() => {
    useAnalyses.setState({
      cards: [
        {
          id: 'c1',
          kind: 'analysis',
          type: 'plspredict',
          options: {},
          run: { at: 1, fingerprint: 'x', options: '{}' },
        },
        { id: 'c2', kind: 'analysis', type: 'methodstext', options: {} },
      ],
    });
    useR.setState({ versions: { R: '4.5.1', webR: '0.5.4' } });
  });

  it('is in the Add menu under Reporting and fits the model first', () => {
    const t = ANALYSIS_TYPES.find((x) => x.id === 'methodstext')!;
    expect(t.group).toBe('Reporting');
    expect(t.fitsModel).toBe(true);
    expect(methodsAnalysis.parseOptions({ anything: 1 })).toEqual({});
    expect(methodsAnalysis.parseOptions('x')).toBeNull();
  });

  it('needs a model and its results', () => {
    expect(methodsAnalysis.blocked({}, { ...ctx, model: undefined })).toMatch(/Draw a model/);
    expect(methodsAnalysis.blocked({}, { ...ctx, pls: null })).toMatch(/Calculate the model first/);
    expect(methodsAnalysis.blocked({}, ctx)).toBeNull();
  });

  it('goes stale when the results, or the bootstrap added to them, change', () => {
    const fp = methodsAnalysis.fingerprint({}, ctx);
    expect(fp).toBeTruthy();
    expect(methodsAnalysis.fingerprint({}, { ...ctx, resultsKey: 'k2' })).not.toBe(fp);
    expect(methodsAnalysis.fingerprint({}, { ...ctx, boot: null })).not.toBe(fp);
    expect(methodsAnalysis.fingerprint({}, { ...ctx, boot: plsBoot({ seed: 7 }) })).not.toBe(fp);
    expect(methodsAnalysis.fingerprint({}, { ...ctx, resultsKey: null })).toBeNull();
  });

  it('reads the log and the R session when it runs, and shows the three formats', async () => {
    const r = await methodsAnalysis.run({}, ctx, () => {});
    expect(r.text).toContain('PLSpredict'); // a run PLSpredict card in the log
    expect(r.text).toContain('webR (version 0.5.4');
    const html = renderToStaticMarkup(<methodsAnalysis.View result={r} options={{}} current />);
    for (const s of ['Plain text', 'LaTeX', 'BibTeX', 'Copy', 'reports no estimates'])
      expect(html).toContain(s);
    expect(html).toContain('Rademaker &amp; Schuberth, 2020');
  });

  it('builds its input from the analysis context', () => {
    expect(reportInput({ ...ctx, model: undefined })).toBeNull();
    const input = reportInput(ctx, [{ type: 'mga', run: true }], { R: '4.5.1' })!;
    expect(input.boot?.samples).toBe(5000);
    expect(input.log).toEqual([{ type: 'mga', run: true }]);
  });

  it('gets the current results with their bootstrap from the project, and none when they are stale', () => {
    useStore.setState({ model: base.model, settings: base.settings });
    const key = resultsKey(useStore.getState());
    useStore.setState({
      results: {
        key,
        pls: plsResult(),
        cb: null,
        miiv: null,
        boot: plsBoot(),
        fitTest: null,
        process: null,
      },
    });
    const c = currentCtx();
    expect(c.resultsKey).toBe(key);
    expect(c.boot?.seed).toBe(1234);
    useStore.setState({
      results: {
        key: 'old',
        pls: plsResult(),
        cb: null,
        miiv: null,
        boot: plsBoot(),
        fitTest: null,
        process: null,
      },
    });
    expect(currentCtx().boot).toBeNull();
    expect(currentCtx().resultsKey).toBeNull();
  });
});

describe('reviewer checklist card', () => {
  beforeEach(() => {
    useAnalyses.setState({
      cards: [
        {
          id: 'c1',
          kind: 'analysis',
          type: 'cmb',
          options: {},
          run: { at: 1, fingerprint: 'x', options: '{}' },
        },
      ],
    });
  });

  it('is in the Add menu under Reporting, needs results, and goes stale with them', () => {
    expect(ANALYSIS_TYPES.find((x) => x.id === 'checklist')?.group).toBe('Reporting');
    expect(checklistAnalysis.fitsModel).toBe(true);
    expect(checklistAnalysis.blocked({}, { ...ctx, pls: null })).toMatch(
      /Calculate the model first/,
    );
    expect(checklistAnalysis.blocked({}, ctx)).toBeNull();
    expect(checklistAnalysis.fingerprint({}, ctx)).not.toBe(
      checklistAnalysis.fingerprint({}, { ...ctx, resultsKey: 'k2' }),
    );
    expect(checklistAnalysis.fingerprint({}, ctx)).not.toBe(methodsAnalysis.fingerprint({}, ctx));
  });

  it('runs the model check and reads the log, and shows each item with its status, evidence, sources and link', async () => {
    const r = await checklistAnalysis.run({}, ctx, () => {});
    expect(r.method).toBe('pls');
    expect(r.items.find((i) => i.id === 'cmb')?.status).toBe('done'); // the cmb card in the log
    expect(r.items.find((i) => i.id === 'specification')).toBeTruthy();
    const html = renderToStaticMarkup(<checklistAnalysis.View result={r} options={{}} current />);
    for (const s of [
      'Measurement model',
      'Structural model',
      'Model tab: Reliability',
      'Add PLSpredict',
      'Hair et al., 2019',
      'Appelbaum et al., 2018',
      'Not applicable',
      'Your call',
    ])
      expect(html, s).toContain(s);
    expect(checklistText(r)).toMatch(/^\[(Done|Issue)\] Model specified/);
  });

  it('works for CB-SEM results', async () => {
    const c = cbInput();
    const r = await checklistAnalysis.run(
      {},
      {
        ...ctx,
        settings: c.settings,
        model: c.model,
        pls: null,
        cb: c.cb,
        boot: c.boot,
        info: c.info,
      },
      () => {},
    );
    expect(r.method).toBe('cbsem');
    expect(
      renderToStaticMarkup(<checklistAnalysis.View result={r} options={{}} current />),
    ).toContain('Jackson, Gillaspy &amp; Purc-Stephenson (2009)');
  });
});
