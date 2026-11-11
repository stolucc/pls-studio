// @vitest-environment happy-dom
// Every analysis card's form, exercised field by field: with the default options for a small PLS-SEM (and, for the
// CB-SEM cards, a CB-SEM) project, each number field, list and checkbox of the form is changed as a user would, and the
// card must set options in which that field changed and which survive parseOptions (as when the project is saved and
// opened again). Catches forms whose fields ignore typing or write options the card later throws away.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { parseCsv } from '../engine/dataset';
import { estimatePls } from '../engine/pls';
import { DEFAULT_SETTINGS, toSpec, type Construct, type ModelState } from '../model/project';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx, AnalysisType } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The mobi data with a few columns outside the model: two- and three-group codes, a subject id and a time index.
const mobi = parseCsv(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mobi.csv'), 'utf8'),
).dataset;
const n = mobi.cols[0].length;
const extra: [string, (i: number) => number][] = [
  ['g', (i) => i % 2],
  ['grp3', (i) => 1 + (i % 3)],
  ['id', (i) => 1 + Math.floor(i / 5)],
  ['time', (i) => i % 5],
];
const data = {
  ...mobi,
  names: [...mobi.names, ...extra.map(([k]) => k)],
  cols: [...mobi.cols, ...extra.map(([, f]) => Float64Array.from({ length: n }, (_, i) => f(i)))],
};
const C = (name: string, indicators: string[], x: number, y: number): Construct => ({
  id: name,
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x,
  y,
  side: 'left',
});
const model: ModelState = {
  constructs: [
    C('EXPE', ['CUEX1', 'CUEX2', 'CUEX3'], 0, 0),
    C('QUAL', ['PERQ1', 'PERQ2', 'PERQ3', 'PERQ4'], 0, 300),
    C('SAT', ['CUSA1', 'CUSA2', 'CUSA3'], 500, 0),
    C('LOY', ['CUSL1', 'CUSL2', 'CUSL3'], 900, 0),
  ],
  paths: [
    { id: 'p1', from: 'EXPE', to: 'SAT' },
    { id: 'p2', from: 'QUAL', to: 'SAT' },
    { id: 'p3', from: 'SAT', to: 'LOY' },
  ],
  moderations: [],
};
const info = { fileName: 'mobi.csv', rows: n, missingCells: 0, excluded: [] };
const plsCtx: AnalysisCtx = {
  data,
  info,
  settings: { ...DEFAULT_SETTINGS, method: 'pls' },
  pls: estimatePls(data, toSpec(model), { missing: 'mean' }),
  cb: null,
  projectName: 'p',
  model,
};
const cbCtx: AnalysisCtx = {
  ...plsCtx,
  settings: { ...DEFAULT_SETTINGS, method: 'cbsem' },
  pls: null,
  cb: estimateCb(data, toSpec(model), 'casewise'),
};

/** Cards whose form is not exercised here, and why (none at present: every card renders from its defaults). */
const SKIPPED: Record<string, string> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Opts = any;
interface Variant {
  key: string;
  card: AnalysisType;
  ctx: AnalysisCtx;
  options: Opts;
}

const variants: Variant[] = ANALYSIS_TYPES.filter((t) => !(t.id in SKIPPED)).flatMap((card) => {
  const ctx = card.group === 'CB-SEM model' ? cbCtx : plsCtx;
  const base = card.defaults(ctx);
  return [
    { key: card.id, card, ctx, options: base },
    ...(card.entries ?? []).map((e) => ({
      key: `${card.id} [${e.title}]`,
      card,
      ctx,
      options: e.options(base),
    })),
  ];
});

let mounted: Root | null = null;
afterEach(() => unmount());

function render(v: Variant, set: (o: Opts) => void = () => {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(<v.card.Options options={v.options} set={set} ctx={v.ctx} disabled={false} />),
  );
  mounted = root;
  return host;
}

type Kind = 'number' | 'select' | 'checkbox';
interface Field {
  variant: Variant;
  kind: Kind;
  index: number;
  name: string;
}
const SELECTOR: Record<Kind, string> = {
  number: 'input[type="number"]',
  select: 'select',
  checkbox: 'input[type="checkbox"]',
};

/** A readable name for a form field: its aria-label, its label's text, its title, or only its position. */
function fieldName(el: Element, kind: Kind, index: number): string {
  const text = (l: Element | null | undefined) => {
    if (!l) return undefined;
    const c = l.cloneNode(true) as Element;
    c.querySelectorAll('select, .hint').forEach((x) => x.remove());
    return c.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) || undefined;
  };
  const label =
    el.getAttribute('aria-label') ??
    (el.id ? text(document.querySelector(`label[for="${el.id}"]`)) : undefined) ??
    text(el.closest('label')) ??
    el.getAttribute('title');
  return `${kind} #${index}${label ? ` "${label}"` : ''}`;
}

/** What tells one field from another across forms of a card (its name without position, range and choices). */
function signature(el: Element, kind: Kind): string {
  const e = el as HTMLInputElement & HTMLSelectElement;
  return [
    kind,
    fieldName(el, kind, 0),
    e.min,
    e.max,
    kind === 'select' ? [...e.options].map((o) => o.value).join('|') : '',
  ].join('/');
}

function usableFields(host: HTMLElement, variant: Variant): (Field & { sig: string })[] {
  return (['number', 'select', 'checkbox'] as Kind[]).flatMap((kind) =>
    [...host.querySelectorAll(SELECTOR[kind])].flatMap((el, index) => {
      const e = el as HTMLInputElement & HTMLSelectElement;
      if (e.disabled) return [];
      if (kind === 'select' && ![...e.options].some((o) => !o.disabled && o.value !== e.value))
        return [];
      return [{ variant, kind, index, name: fieldName(el, kind, index), sig: signature(el, kind) }];
    }),
  );
}

/** The buttons of segmented controls not pressed yet: the switches between modes of a form. */
const modeButtons = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLButtonElement>('.segmented button')].filter(
    (b) => !b.disabled && !b.classList.contains('on'),
  );

function unmount() {
  if (mounted) act(() => mounted!.unmount());
  mounted = null;
  document.body.innerHTML = '';
}

// The fields of each form, found by rendering it with its defaults; fields that only show after pressing one of its
// segmented buttons (a mode switch such as "Enter the smallest path") are found by rendering the options that button sets.
const fields: Field[] = [];
const renderErrors: Record<string, unknown> = {};
const buttonVariants: Variant[] = [];
const seenByCard = new Map<string, Set<string>>();
for (const variant of variants) {
  try {
    const host = render(variant);
    // (a field already exercised in another form of the card, e.g. another Add-menu entry, is not repeated)
    const seen = seenByCard.get(variant.card.id) ?? new Set<string>();
    seenByCard.set(variant.card.id, seen);
    const own = usableFields(host, variant).filter((f) => !seen.has(f.sig));
    fields.push(...own);
    own.forEach((f) => seen.add(f.sig));
    const buttons = modeButtons(host).map(
      (b, i) => [i, b.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30) ?? ''] as const,
    );
    unmount();
    for (const [i, label] of buttons) {
      const set = vi.fn();
      const h = render(variant, set);
      const b = modeButtons(h)[i];
      if (b) act(() => b.click());
      unmount();
      const next = set.mock.lastCall?.[0];
      if (!next || variant.card.parseOptions(JSON.parse(JSON.stringify(next))) === null) continue;
      const v: Variant = {
        key: `${variant.key} {after “${label}”}`,
        card: variant.card,
        ctx: variant.ctx,
        options: next,
      };
      try {
        const nf = usableFields(render(v), v).filter((f) => !seen.has(f.sig));
        if (nf.length) {
          buttonVariants.push(v);
          fields.push(...nf);
          nf.forEach((f) => seen.add(f.sig));
        }
      } catch (err) {
        renderErrors[v.key] = err;
        buttonVariants.push(v);
      }
      unmount();
    }
  } catch (err) {
    renderErrors[variant.key] = err;
  }
  unmount();
}

/** A valid value for a number field that differs from the one it shows. */
function nextNumber(input: HTMLInputElement): string {
  const cur = Number(input.value);
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  const step =
    input.step === '' || input.step === 'any'
      ? Number.isInteger(cur)
        ? 1
        : 0.01
      : Number(input.step);
  const fmt = (x: number) => String(Number(x.toFixed(10)));
  const base = Number.isFinite(cur) && input.value !== '' ? cur : Number.isFinite(min) ? min : 0;
  const tries = [
    base + step,
    base - step,
    Number.isFinite(min) && Number.isFinite(max)
      ? min + Math.round((max - min) / 2 / step) * step
      : NaN,
    min,
    max,
  ];
  const v = tries.find((x) => Number.isFinite(x) && x >= min && x <= max && Number(fmt(x)) !== cur);
  if (v === undefined)
    throw new Error(
      `no other valid value for a number field (value ${input.value}, min ${input.min}, max ${input.max})`,
    );
  return fmt(v);
}

/** The paths of the leaves in which two option objects differ. */
function changed(a: unknown, b: unknown, path: string[] = []): string[][] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      changed((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...path, k]),
    );
  }
  return [path];
}
const at = (o: unknown, path: string[]) =>
  path.reduce<unknown>(
    (x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined),
    o,
  );

describe('every card’s form renders with its default options', () => {
  it.each([...variants, ...buttonVariants].map((v) => [v.key, v] as const))('%s', (key) => {
    expect(renderErrors[key]).toBeUndefined();
  });
  // (and with the other method's project: a PLS-SEM card's form in a CB-SEM project and the other way round)
  it.each(variants.map((v) => [v.key, v] as const))('%s, other method', (_, v) => {
    const ctx = v.ctx === cbCtx ? plsCtx : cbCtx;
    expect(() => render({ ...v, ctx, options: v.card.defaults(ctx) })).not.toThrow();
  });
});

describe('every field of every card’s form sets options that survive parseOptions', () => {
  it.each(fields.map((f) => [`${f.variant.key}: ${f.name}`, f] as const))('%s', (_, f) => {
    const set = vi.fn();
    const host = render(f.variant, set);
    const el = host.querySelectorAll(SELECTOR[f.kind])[f.index] as HTMLInputElement &
      HTMLSelectElement;
    let typed: number | null = null;
    act(() => {
      if (f.kind === 'checkbox') el.click();
      else if (f.kind === 'select') {
        const other = [...el.options].filter((o) => !o.disabled && o.value !== el.value);
        const pick = other.find((o) => o.value !== '') ?? other[0];
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
          el,
          pick.value,
        );
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const text = nextNumber(el);
        typed = Number(text);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    if (f.kind === 'number' && !set.mock.calls.length)
      act(() => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(set, 'the form did not set options').toHaveBeenCalled();
    const next = set.mock.lastCall![0];
    const diff = changed(f.variant.options, next);
    expect(diff, 'the options did not change').not.toEqual([]);
    if (typed !== null) {
      // the typed number lands in the options (as typed, or as a percentage of it)
      const values = diff.map((p) => at(next, p));
      expect(
        values.some(
          (x) =>
            typeof x === 'number' &&
            [typed!, typed! / 100, typed! * 100].some((t) => Math.abs(x - t) < 1e-9),
        ),
        `typed ${typed}, options changed: ${JSON.stringify(diff.map((p, i) => [p.join('.'), values[i]]))}`,
      ).toBe(true);
    }
    const parsed = f.variant.card.parseOptions(JSON.parse(JSON.stringify(next)));
    expect(parsed, 'parseOptions rejected the options').not.toBeNull();
    for (const p of diff)
      expect(at(parsed, p), `parseOptions changed ${p.join('.')}`).toEqual(
        at(JSON.parse(JSON.stringify(next)), p),
      );
  });
});
