import { describe, expect, it } from 'vitest';
import { examplePanels, PACKAGE_EXAMPLES, panelPreset } from '../examples/packages';
import { DEFAULT_SETTINGS } from '../model/project';
import { analysisType } from './registry';
import type { AnalysisCtx } from './types';

const ctx: AnalysisCtx = {
  data: null,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};

describe('package examples that open as analysis cards', () => {
  it('give options the card accepts unchanged', () => {
    const cards = PACKAGE_EXAMPLES.filter((e) => e.panel && analysisType(e.panel.kind));
    expect(cards.map((e) => e.panel!.kind)).toEqual(expect.arrayContaining(['nca', 'rsa']));
    for (const e of cards)
      for (const p of examplePanels(e)) {
        const kind = p.kind,
          preset = panelPreset(p);
        const t = analysisType(kind)!;
        expect(t, `${e.id}: ${kind}`).toBeTruthy();
        const options = t.parseOptions({ ...t.defaults(ctx), ...preset }) as Record<
          string,
          unknown
        >;
        for (const [k, v] of Object.entries(preset)) expect(options[k], `${e.id}: ${k}`).toEqual(v);
      }
  });
});
