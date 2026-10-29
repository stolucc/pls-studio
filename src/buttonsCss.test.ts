import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Labels may wrap to two lines (segmented tabs in narrow columns): buttons
// must grow with their text, so no button rule may fix its height.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
const isButton = (sel: string) => sel.split(',').some((s) => /(^|[\s>.])(btn|button)\b/.test(s.trim()) && !/\.btn\.icon\b/.test(s));

describe('button sizing (text always fits)', () => {
  it('finds the button rules', () => {
    expect(rules.filter((r) => isButton(r.sel)).length).toBeGreaterThan(10);
  });

  it('no button rule fixes its height (min-height only)', () => {
    const fixed = rules.filter((r) => isButton(r.sel) && /(^|[;\s])height\s*:/.test(r.body)).map((r) => r.sel);
    expect(fixed).toEqual([]);
  });

  it('segmented controls wrap onto another row instead of overflowing', () => {
    const seg = rules.find((r) => r.sel === '.segmented')!;
    expect(seg.body).toMatch(/flex-wrap:\s*wrap/);
  });
});
