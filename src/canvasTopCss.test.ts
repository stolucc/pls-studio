import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The bars at the top of the canvas (version badge, tools, tool hint, PROCESS
// bar) flow in one container inside the canvas: on a narrow canvas the tools
// wrap onto another row instead of spilling over the Data panel and the
// Inspector (they used to be centred with absolute positioning and overflowed
// both sides at 1400 px with the CB-SEM tools).
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
  sel: sel.trim(),
  body,
}));
const rule = (sel: string) => rules.find((r) => r.sel === sel)!.body;
const canvas = readFileSync(new URL('./components/Canvas.tsx', import.meta.url), 'utf8');

describe('the bars at the top of the canvas', () => {
  it('sit in one container spanning the canvas, with the tools wrapping inside it', () => {
    expect(rule('.canvas-top')).toMatch(/position:\s*absolute/);
    expect(rule('.canvas-top')).toMatch(/left:\s*12px/);
    expect(rule('.canvas-top')).toMatch(/right:\s*12px/);
    expect(rule('.tool-dock')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.tool-dock')).toMatch(/max-width:\s*100%/);
  });

  it('are not positioned on their own any more', () => {
    for (const sel of ['.tool-dock', '.tool-hint', '.version-badge', '.process-bar']) {
      expect(rule(sel), sel).not.toMatch(/position:\s*absolute/);
      expect(rule(sel), sel).not.toMatch(/translateX/);
    }
  });

  it('are rendered inside the container', () => {
    const top = canvas.slice(canvas.indexOf('className="canvas-top"'));
    const block = top.slice(0, top.indexOf('<svg'));
    for (const part of ['<ModelVersionBadge />', '<ToolDock', 'tool-hint', '<ProcessBar']) {
      expect(block, part).toContain(part);
    }
  });
});
