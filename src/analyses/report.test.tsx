// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnalysesWorkspace } from '../components/analyses/AnalysesWorkspace';
import { parseProject, serializeProject } from '../model/project';
import { useStore } from '../store';
import { parseCards } from './persist';
import { buildReport, cleanResult } from './report';
import { addFrozenCard, addText, cardStatus, currentCtx, loadCards, setTitle, useAnalyses } from './store';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCard } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mount = () => { const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); act(() => root.render(<AnalysesWorkspace />)); return () => { act(() => root.unmount()); host.remove(); }; };

beforeEach(() => { useStore.getState().newProject(); useStore.setState({ cloud: null }); loadCards([]); useAnalyses.setState({ results: {}, errors: {} }); });

describe('report', () => {
  it('has the cards in order, escapes the user’s text, and contains no controls or scripts', async () => {
    addText('heading', '<script>alert(1)</script> Measurement');
    addText('note', 'Three factors <b>expected</b>.');
    await addFrozenCard('snapshot', { label: 'CB-SEM model, snapshot 1' }, { method: 'cbsem', description: 'lavaan', diagram: null, level: 0.95, cb: null });
    const unmount = mount();
    const html = buildReport(useAnalyses.getState().cards, 'My <project>');
    unmount();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Measurement');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('Three factors &lt;b&gt;expected&lt;/b&gt;.');
    expect(html).toContain('My &lt;project&gt;');
    expect(html.indexOf('Measurement')).toBeLessThan(html.indexOf('CB-SEM model, snapshot 1'));
    expect(html).not.toMatch(/<button|<input|<select/);
  });

  it('heads a renamed card with its own title', async () => {
    const id = (await addFrozenCard('snapshot', { label: 'PLS-SEM model, snapshot 1' }, { method: 'pls', description: 'cSEM', diagram: null, level: 0.95 }))!;
    setTitle(id, 'Baseline model <before> pruning');
    const unmount = mount();
    const html = buildReport(useAnalyses.getState().cards, 'P');
    unmount();
    expect(html).toContain('<h3>Baseline model &lt;before&gt; pruning</h3>');
    expect(html).not.toContain('<h3>PLS-SEM model, snapshot 1</h3>');
  });

  it('cleans a result: no event handlers, links or foreign images; charts as images', () => {
    const el = document.createElement('div');
    el.innerHTML = '<div class="card-result"><table class="grid" onclick="x()"><tr><td class="num" onmouseover="y()">1.0</td></tr></table>'
      + '<a href="javascript:z()">link</a><img src="https://evil.example/x.png"><img src="data:image/png;base64,AAAA">'
      + '<svg width="10" height="10" aria-label="Chart"><circle r="2"/></svg><button>Copy</button>'
      + '<div><div class="table-tools"><h3>Construct scores</h3><button>Save</button></div><div class="table-note">Scores.</div></div></div>';
    const out = cleanResult(el.firstElementChild!).outerHTML;
    expect(out).not.toMatch(/onclick|onmouseover|javascript:|evil\.example|<button|<svg|Construct scores/);
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toMatch(/<img src="data:image\/svg\+xml;base64,[^"]+" width="10" alt="Chart">/);
  });
});

describe('model snapshots', () => {
  it('are frozen cards: current, never run, not in the Add menu, saved with the project', async () => {
    const id = await addFrozenCard('snapshot', { label: 'PLS-SEM model, snapshot 1' }, { method: 'pls', description: 'cSEM', diagram: '<svg/>', level: 0.95 });
    const card = useAnalyses.getState().cards.find((c) => c.id === id) as AnalysisCard;
    expect(cardStatus(card, currentCtx(), false, true)).toEqual({ state: 'current' });
    expect(cardStatus({ ...card, options: { label: 'renamed' } }, currentCtx(), false, true).state).toBe('current');
    expect(ANALYSIS_TYPES.find((t) => t.id === 'snapshot')!.frozen).toBe(true);
    const s = useStore.getState();
    const back = parseCards(parseProject(serializeProject(s.model, s.settings, null, null, null, useAnalyses.getState().cards)).analyses);
    expect((back[0] as AnalysisCard).run?.packed).toBeTruthy();
    expect((back[0] as AnalysisCard).options).toEqual({ label: 'PLS-SEM model, snapshot 1' });
  });

  it('are refused to viewers of a shared project', async () => {
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(await addFrozenCard('snapshot', { label: 'x' }, { method: 'pls' })).toBeNull();
  });
});
