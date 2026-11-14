// @vitest-environment happy-dom
// The failed-HTMT "What now?" panel and the loading triage on the mobi example (built-in
// engine): what they show, the similar-pair switch, the bootstrap's upper bounds, and deletion
// only after confirmation, logged in the project.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estimatePls } from '../../engine/pls';
import { indicatorData } from '../../measurement/htmt';
import { reestimationCandidates, triageItems } from '../../measurement/loadings';
import { reestimateRemovals, removalKey } from '../../measurement/reestimate';
import { mobi, REFERENCE_OPTIONS } from '../../measurement/__fixtures__/data';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { resultsKey, useStore } from '../../store';
import { ConfirmModal } from '../Overlays';
import { HtmtHelper, runHtmtBootstrap, useHtmtBoot } from './HtmtHelper';
import { LoadingTriage, useTriage } from './LoadingTriage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { data, model } = mobi();
const settings = { ...DEFAULT_SETTINGS, engine: 'builtin' as const, bootSamples: 40, seed: 7 };
const pls = estimatePls(data, toSpec(model), REFERENCE_OPTIONS);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useStore.setState({ model, data, settings, job: null });
  useHtmtBoot.setState({ key: null, result: null, running: null, error: null });
  useTriage.setState({ key: null, runs: {}, running: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;

describe('HTMT: what now?', () => {
  it('lists the failing pairs and opens the panel with the rules, drivers and options', () => {
    act(() => root.render(<HtmtHelper pls={pls} />));
    const text = host.textContent ?? '';
    expect(text).toContain('HTMT inference');
    expect(text).toContain('Quality and Image');
    expect(text).toContain('HTMT at or above the threshold');
    expect(text).not.toContain('HTMT takes precedence');
    act(() => button('What')!.click());
    const open = host.textContent ?? '';
    expect(open).toContain('HTMT takes precedence over the Fornell–Larcker criterion');
    expect(open).toContain('(Henseler et al. 2015; Hair et al. 2021)');
    expect(open).toContain('does not establish discriminant validity (Franke & Sarstedt 2019)');
    expect(open).toContain('Reconsider whether the constructs are distinct');
    expect(open).toContain('Merge the constructs');
    expect(open).toContain('Report HTMT inference');
    expect(open).toContain('Cross-loading');
    expect(open).toContain('Run the HTMT bootstrap to get it.');
  });

  it('the similar-pair switch is saved in the model and moves the threshold to 0.90', () => {
    act(() => root.render(<HtmtHelper pls={pls} />));
    act(() => button('What')!.click());
    const box = host.querySelector('.mq-similar input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    act(() => box.click());
    const pairs = useStore.getState().model.measurement?.similarPairs;
    expect(pairs).toHaveLength(1);
    const names = pairs![0].map((id) => model.constructs.find((k) => k.id === id)!.name).sort();
    expect(names).toEqual(['Expectation', 'Image']); // the first pair listed
  });

  it('shows the bootstrap upper bounds once computed', async () => {
    const ind = indicatorData(data, toSpec(model), 'mean');
    const key = `${resultsKey(useStore.getState())}|40|7`;
    await runHtmtBootstrap(ind, [['Value', 'Image']], 40, 7, key, 'absolute');
    expect(useHtmtBoot.getState().result?.samples).toBe(40);
    act(() => root.render(<HtmtHelper pls={pls} />));
    expect(host.textContent).toContain('Bootstrap: 40 of 40 samples, seed 7.');
  });
});

describe('loading triage', () => {
  it('gives each reflective indicator its rule, and the effect of removing it once re-estimated', async () => {
    act(() => root.render(<LoadingTriage pls={pls} />));
    let text = host.textContent ?? '';
    expect(text).toContain('Loading triage (reflective indicators)');
    expect(text).toContain('Below 0.40: candidate for deletion');
    expect(text).toContain('Re-estimate without each indicator below 0.70 (6 runs)');
    const items = reestimationCandidates(triageItems(model, pls));
    const estimate = (spec: ReturnType<typeof toSpec>) =>
      Promise.resolve(estimatePls(data, spec, REFERENCE_OPTIONS));
    const runs = await reestimateRemovals(model, items, estimate);
    act(() =>
      useTriage.setState({
        key: resultsKey(useStore.getState()),
        runs: Object.fromEntries(runs.map((r) => [removalKey(r), r])),
      }),
    );
    text = host.textContent ?? '';
    expect(text).not.toContain('runs)');
    // IMAG2: Image's AVE 0.478 → 0.540 (seminr, scripts/validation/loading_triage.R)
    expect(text).toContain('Removal raises AVE from 0.48 to 0.54, above the threshold.');
    expect(text).toContain('0.540');
  });

  it('deletes an indicator only after confirmation, and logs it', async () => {
    act(() =>
      root.render(
        <>
          <LoadingTriage pls={pls} />
          <ConfirmModal />
        </>,
      ),
    );
    const before = useStore.getState().model;
    const del = [...host.querySelectorAll('button')].find((b) =>
      b.title.startsWith('Delete CUSL2'),
    )!;
    act(() => del.click());
    expect(host.textContent).toContain('Delete CUSL2 from Loyalty?');
    // Cancelling changes nothing.
    act(() => button('Cancel')!.click());
    expect(useStore.getState().model).toBe(before);
    act(() => del.click());
    await act(async () => button('Delete indicator')!.click());
    const after = useStore.getState().model;
    expect(after.constructs.find((k) => k.name === 'Loyalty')!.indicators).toEqual([
      'CUSL1',
      'CUSL3',
    ]);
    const log = after.measurement?.deletedItems;
    expect(log).toHaveLength(1);
    expect(log![0]).toMatchObject({ indicator: 'CUSL2', construct: 'Loyalty' });
    expect(log![0].reason).toContain('below 0.40');
  });
});
