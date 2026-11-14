// @vitest-environment happy-dom
// The negative-loading note on the Loadings & weights tab: the question, the button that opens the
// Data tab's reverse-coding dialog (scale prefilled from the observed range) and reverse-codes the
// item, the dismissal kept in the project, and the loading triage naming reverse-coding first.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CbResult } from '../../engine/cbsem';
import { DEFAULT_SETTINGS } from '../../model/project';
import { cbModel, cbResult, plsModel, plsResult } from '../../reporting/fixtures';
import { useStore } from '../../store';
import { ConfirmModal } from '../Overlays';
import { LoadingTriage, NEGATIVE_FIRST } from './LoadingTriage';
import { CbNegativeLoadings, PlsNegativeLoadings, REESTIMATE_TEXT } from './NegativeLoadingNote';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Image: im1..im3 (im2 loads negatively); Satisfaction (Mode B): sa1..sa4; Loyalty: lo1, lo2.
const pls = plsResult({ loadings: [0.82, -0.6, 0.7, 0.5, 0.8, 0.75, 0.6, 0.9, 0.88] });
const names = plsModel.constructs.flatMap((k) => k.indicators);
// Answers on 2..6 (a 1–7 scale on which nobody chose 1 or 7): the dialog offers 2, 6.
const data = {
  names,
  cols: names.map((_, k) => Float64Array.from({ length: 20 }, (_, i) => 2 + ((i + k) % 5))),
};
const info = { fileName: 'survey.csv', rows: 20, missingCells: 0, excluded: [] };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useStore.setState({
    model: plsModel,
    data,
    dataInfo: info,
    settings: { ...DEFAULT_SETTINGS, method: 'pls' },
    job: null,
    toasts: [],
    history: null,
    past: [],
    future: [],
  });
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

/** A button of the dialog. */
const modalButton = (text: string) =>
  [...host.querySelectorAll('.modal button')].find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

const renderPls = () =>
  act(() =>
    root.render(
      <>
        <PlsNegativeLoadings pls={pls} />
        <ConfirmModal />
      </>,
    ),
  );

describe('the negative-loading note', () => {
  it('asks whether the item is reverse-coded', () => {
    renderPls();
    expect(host.textContent).toContain(
      'im2 loads negatively on Image (−0.60). Is it a negatively worded (reverse-coded) item?',
    );
    expect(button('Reverse-code im2…')).toBeDefined();
    expect(button('Not reverse-coded — dismiss')).toBeDefined();
  });

  it('opens the reverse-coding dialog with the observed range, and reverse-codes the item', async () => {
    renderPls();
    act(() => button('Reverse-code im2…')!.click());
    expect(host.textContent).toContain('Reverse-code im2?');
    const input = host.querySelector('.modal input') as HTMLInputElement;
    expect(input.value).toBe('2, 6');
    const before = Array.from(data.cols[1]);
    await act(async () => modalButton('Reverse-code')!.click());
    const s = useStore.getState();
    expect(s.dataInfo?.reversed).toEqual([{ name: 'im2', min: 2, max: 6 }]);
    expect(Array.from(s.data!.cols[1])).toEqual(before.map((v) => 8 - v));
    const toast = s.toasts[s.toasts.length - 1];
    expect(toast.text).toBe(`Reverse-coded im2 (2–6). ${REESTIMATE_TEXT}`);
    // (the results on screen are those of the old coding: until estimated again, the note stays away)
    expect(host.textContent).not.toContain('im2 loads negatively');
  });

  it('cancelling the dialog changes nothing', () => {
    renderPls();
    act(() => button('Reverse-code im2…')!.click());
    act(() => modalButton('Cancel')!.click());
    expect(useStore.getState().data).toBe(data);
    expect(useStore.getState().dataInfo).toBe(info);
  });

  it('dismissing is saved in the project and hides the note', () => {
    renderPls();
    act(() => button('Not reverse-coded — dismiss')!.click());
    expect(useStore.getState().model.measurement).toEqual({ notReversed: ['im2'] });
    expect(host.textContent).not.toContain('im2 loads negatively');
  });

  it('explains in one line that negative Mode B weights are not flagged', () => {
    const weights = [0.4, 0.4, 0.4, -0.2, 0.5, 0.4, 0.3, 0.6, 0.5];
    act(() => root.render(<PlsNegativeLoadings pls={plsResult({ weights })} />));
    expect(host.textContent).toContain('Negative weights of formative (Mode B)');
    expect(host.textContent).toContain('Negative here: sa1.');
    act(() => root.render(<PlsNegativeLoadings pls={plsResult()} />));
    expect(host.textContent).toBe('');
  });

  it('CB-SEM: the standardised loading of the Loadings tab', () => {
    useStore.setState({ model: cbModel });
    const base = cbResult();
    const cb: CbResult = cbResult({
      estimates: base.estimates.map((e) => (e.rhs === 'x3' ? { ...e, std: -0.42 } : e)),
    });
    act(() => root.render(<CbNegativeLoadings cb={cb} />));
    expect(host.textContent).toContain('x3 loads negatively on Anxiety (−0.42)');
  });

  it('a covariance matrix cannot be reverse-coded: no button, a hint instead', () => {
    useStore.setState({
      data: { names, cols: [], moments: { S: [], n: 100 } } as unknown as typeof data,
    });
    renderPls();
    expect(button('Reverse-code im2…')).toBeUndefined();
    expect(host.textContent).toContain('reverse-code the item in the raw data');
  });
});

describe('the loading triage', () => {
  it('names reverse-coding first for a negative loading, until dismissed', () => {
    act(() => root.render(<LoadingTriage pls={pls} />));
    const row = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.startsWith('im2'))!;
    expect(row.textContent).toContain(NEGATIVE_FIRST);
    act(() => useStore.setState({ model: { ...plsModel, measurement: { notReversed: ['im2'] } } }));
    const after = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.startsWith('im2'))!;
    expect(after.textContent).not.toContain(NEGATIVE_FIRST);
  });
});

describe('the answer scale', () => {
  it('reads "lowest, highest" in several spellings', async () => {
    const { parseScale } = await import('../reverseCodeDialog');
    expect(parseScale('1, 5')).toEqual([1, 5]);
    expect(parseScale('1–7')).toEqual([1, 7]);
    expect(parseScale('0 10')).toEqual([0, 10]);
    expect(parseScale('5, 1')).toBeNull();
    expect(parseScale('1')).toBeNull();
    expect(parseScale('a, b')).toBeNull();
  });
});
