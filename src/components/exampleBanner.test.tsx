// @vitest-environment happy-dom
// What the open example shows: a banner on the Model and Analyses tabs, hidden per example; the home cards carry the
// same text; and the Messages panel marks the messages the open example is expected to raise.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PACKAGE_EXAMPLES } from '../examples/packages';
import { emptyModel, useStore, type Message } from '../store';
import { AnalysesWorkspace } from './analyses/AnalysesWorkspace';
import { EXAMPLES, HomeScreen } from './HomeScreen';
import { ExampleBanner, exampleExpectedMessages, exampleShows, resetExampleBanners } from './ExampleBanner';
import { MessagesView } from './results/Messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const s = () => useStore.getState();
const roots: Root[] = [];
function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(el));
  return host;
}
const open = (example: string) => s().loadProject({ name: `Example: ${example}`, model: emptyModel(), settings: s().settings, data: null, info: null, example });
const pkg = PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs')!;

beforeEach(() => { s().newProject(); resetExampleBanners(); });
afterEach(() => { for (const r of roots.splice(0)) act(() => r.unmount()); });

describe('the example banner', () => {
  it('finds the text of package and built-in examples, and nothing without an example', () => {
    expect(exampleShows('lavaan-hs')).toBe(pkg.shows);
    expect(exampleShows('kline-roth')).toBe(EXAMPLES.find((e) => e.id === 'kline-roth')!.shows);
    expect(exampleShows(null)).toBeUndefined();
    expect(exampleShows('no-such-example')).toBeUndefined();
  });

  it('shows nothing while no example is open', () => {
    expect(mount(<ExampleBanner where="model" />).innerHTML).toBe('');
  });

  it('shows what the open example shows, on the Model and on the Analyses tab', () => {
    open('lavaan-hs');
    const model = mount(<ExampleBanner where="model" />);
    expect(model.querySelector('.example-banner.model')!.textContent).toContain(pkg.shows!);
    const analyses = mount(<AnalysesWorkspace />);
    expect(analyses.querySelector('.example-banner.analyses')!.textContent).toContain(pkg.shows!);
    // (the diagram's banner sits in the canvas, which needs React Flow to render)
    expect(readFileSync(join(__dirname, 'Canvas.tsx'), 'utf8')).toContain('<ExampleBanner where="model" />');
  });

  it('a built-in example has its banner too', () => {
    open('kline-roth');
    expect(mount(<ExampleBanner where="model" />).textContent).toContain(exampleShows('kline-roth')!);
  });

  it('hides for that example everywhere when closed, and stays for the others', () => {
    open('lavaan-hs');
    const a = mount(<ExampleBanner where="model" />), b = mount(<ExampleBanner where="analyses" />);
    act(() => { (a.querySelector('button[aria-label="Hide what this example shows"]') as HTMLButtonElement).click(); });
    expect(a.innerHTML).toBe('');
    expect(b.innerHTML).toBe('');
    act(() => { open('kline-roth'); });
    expect(a.querySelector('.example-banner')).not.toBeNull();
    act(() => { open('lavaan-hs'); });
    expect(a.innerHTML).toBe('');
  });

  it('says it describes the example as it opened once the model changes, and goes when the example is kept as a project', () => {
    open('lavaan-hs');
    const host = mount(<ExampleBanner where="model" />);
    expect(host.querySelector('.example-banner-changed')).toBeNull();
    act(() => { s().loadProject({ name: 'x', model: emptyModel(), settings: s().settings, data: null, info: null, example: 'lavaan-hs' }); useStore.setState({ settings: { ...s().settings, method: s().settings.method === 'pls' ? 'cbsem' : 'pls' } }); });
    expect(host.querySelector('.example-banner-changed')!.textContent).toContain('as it opened');
    act(() => { s().keepExample(); });
    expect(host.innerHTML).toBe('');
  });

  it('home cards carry the text of every example', () => {
    const host = mount(<HomeScreen />);
    const texts = [...host.querySelectorAll('.example-card .example-shows')].map((p) => p.textContent ?? '');
    expect(texts.length).toBe(host.querySelectorAll('.example-card').length);
    expect(texts.some((t) => t.includes(pkg.shows!))).toBe(true);
    expect(texts.some((t) => t.includes(exampleShows('kline-roth')!))).toBe(true);
  });
});

describe('the Messages panel in an example', () => {
  const msg = (id: number, level: Message['level'], text: string): Message => ({ id, at: 0, level, text, source: 'R' });
  const job = PACKAGE_EXAMPLES.find((e) => e.id === 'stats-contingency-job')!;

  it('marks the messages the example expects as expected, with the reason, and leaves the others as they are', () => {
    open('stats-contingency-job');
    expect(exampleExpectedMessages('stats-contingency-job')).toBe(job.expectedMessages);
    useStore.setState({ messages: [msg(1, 'warning', 'Chi-squared approximation may be incorrect'), msg(2, 'warning', 'the model did not converge'), msg(3, 'error', 'Chi-squared approximation may be incorrect')] });
    const host = mount(<MessagesView />);
    const items = [...host.querySelectorAll('li.message')];
    const expected = items.filter((li) => li.classList.contains('expected'));
    expect(expected.length).toBe(1);
    expect(expected[0].textContent).toContain('Expected in this example');
    expect(expected[0].textContent).toContain(job.expectedMessages![0].why);
    expect(expected[0].classList.contains('warning')).toBe(true);
    // (an error is never expected; a warning the example does not name stays a problem)
    expect(items.find((li) => li.textContent?.includes('did not converge'))!.classList.contains('expected')).toBe(false);
    expect(items.find((li) => li.classList.contains('error'))!.classList.contains('expected')).toBe(false);
  });

  it('marks nothing outside the example', () => {
    useStore.setState({ messages: [msg(1, 'warning', 'Chi-squared approximation may be incorrect')] });
    expect(mount(<MessagesView />).querySelector('.expected')).toBeNull();
    open('lavaan-hs');
    useStore.setState({ messages: [msg(1, 'warning', 'Chi-squared approximation may be incorrect')] });
    expect(mount(<MessagesView />).querySelector('.expected')).toBeNull();
  });
});
