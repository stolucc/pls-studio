import { beforeEach, describe, expect, it } from 'vitest';
import type { CbResult } from '../engine/cbsem';
import { emptyModel, useStore } from '../store';
import {
  appendModifications,
  describeModification,
  freeParameter,
  MAX_MODIFICATIONS,
  parseModifications,
  removalEntries,
  removalStreak,
  removalWarning,
  type PostHocModification,
} from './posthoc';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type Construct,
  type ModelState,
} from './project';

const F = (id: string, name: string, indicators: string[]): Construct => ({
  id,
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
});
const hs: ModelState = {
  constructs: [
    F('v', 'visual', ['x1', 'x2', 'x3']),
    F('t', 'textual', ['x4', 'x5', 'x6']),
    F('s', 'speed', ['x7', 'x8', 'x9']),
  ],
  paths: [{ id: 'p1', from: 'v', to: 's' }],
  moderations: [],
};
const entry = (over: Partial<PostHocModification> = {}): PostHocModification => ({
  id: 'h1',
  kind: 'free',
  lhs: 'x7',
  op: '~~',
  rhs: 'x8',
  at: 1_700_000_000_000,
  mi: 34.1,
  sepc: 0.86,
  decision: 'EPC:M',
  ...over,
});

describe('parseModifications (untrusted project files)', () => {
  it('keeps well-formed entries as they are; absent stays absent', () => {
    const log = [entry(), entry({ id: 'h2', kind: 'remove', op: '~', p: 0.31, group: 'g' })];
    log[1].mi = undefined;
    const clean = JSON.parse(JSON.stringify(log));
    expect(parseModifications(clean)).toEqual(clean);
    expect(parseModifications(undefined)).toBeUndefined();
  });

  it.each([
    ['not a list', { a: 1 }],
    ['an entry that is not an object', ['x']],
    ['an unknown kind', [{ ...entry(), kind: 'drop' }]],
    ['an unknown operator', [{ ...entry(), op: '~1' }]],
    ['no time', [{ ...entry(), at: undefined }]],
    ['a time that is not a number', [{ ...entry(), at: '1' }]],
    ['an empty name', [{ ...entry(), lhs: '' }]],
    ['a name too long', [{ ...entry(), rhs: 'x'.repeat(201) }]],
    ['an id too long', [{ ...entry(), id: 'h'.repeat(65) }]],
    ['an unknown decision', [{ ...entry(), decision: 'maybe' }]],
    ['an infinite MI', [{ ...entry(), mi: Number.POSITIVE_INFINITY }]],
    ['a negative MI', [{ ...entry(), mi: -1 }]],
    ['a p above 1', [{ ...entry(), p: 1.5 }]],
    ['a group that is not text', [{ ...entry(), group: 3 }]],
    ['too many entries', Array.from({ length: MAX_MODIFICATIONS + 1 }, () => entry())],
  ])('rejects %s', (_what, raw) => {
    expect(() => parseModifications(raw)).toThrow(/Invalid project file/);
  });

  it('drops fields it does not know', () => {
    const [e] = parseModifications([{ ...entry(), script: '<x>' }])!;
    expect(e).not.toHaveProperty('script');
  });
});

describe('the modification log in a project file', () => {
  it('round-trips through serializeProject / parseProject', () => {
    const model = { ...hs, modifications: [entry()] };
    const back = parseProject(serializeProject(model, DEFAULT_SETTINGS, null, null)).model;
    expect(back.modifications).toEqual([entry()]);
  });

  it('makes a project file with a malformed log invalid', () => {
    const text = serializeProject(
      { ...hs, modifications: [{ ...entry(), kind: 'evil' } as never] },
      DEFAULT_SETTINGS,
      null,
      null,
    );
    expect(() => parseProject(text)).toThrow(/post hoc modification/);
  });

  it('leaves the field out when the log is empty', () => {
    const text = serializeProject({ ...hs, modifications: [] }, DEFAULT_SETTINGS, null, null);
    expect(parseProject(text).model).not.toHaveProperty('modifications');
  });
});

describe('freeParameter', () => {
  it('a residual covariance between two indicators', () => {
    const m = freeParameter(hs, { lhs: 'x7', op: '~~', rhs: 'x8', mi: 34, sepc: 0.86 }, 'M', 5)!;
    expect(m.correlations).toEqual([
      { id: expect.any(String), kind: 'indicator', a: 'x7', b: 'x8' },
    ]);
    expect(m.modifications).toEqual([
      {
        id: expect.any(String),
        kind: 'free',
        lhs: 'x7',
        op: '~~',
        rhs: 'x8',
        at: 5,
        mi: 34,
        sepc: 0.86,
        decision: 'M',
      },
    ]);
  });

  it('a cross-loading: the indicator joins the factor too', () => {
    const m = freeParameter(
      hs,
      { lhs: 'visual', op: '=~', rhs: 'x9', mi: 36, sepc: 0.5 },
      null,
      1,
    )!;
    expect(m.constructs[0].indicators).toEqual(['x1', 'x2', 'x3', 'x9']);
    expect(m.constructs[2].indicators).toEqual(['x7', 'x8', 'x9']);
    expect(m.modifications![0]).not.toHaveProperty('decision');
  });

  it('a path between constructs, and a covariance between them (by id)', () => {
    const p = freeParameter(
      hs,
      { lhs: 'textual', op: '~', rhs: 'visual', mi: 9, sepc: 0.3 },
      'M',
      1,
    )!;
    expect(p.paths.at(-1)).toMatchObject({ from: 'v', to: 't' });
    const k = freeParameter(
      hs,
      { lhs: 'textual', op: '~~', rhs: 'speed', mi: 9, sepc: 0.3 },
      'M',
      1,
    )!;
    expect(k.correlations![0]).toMatchObject({ kind: 'construct', a: 't', b: 's' });
  });

  it('records the group whose index suggested it', () => {
    const m = freeParameter(
      hs,
      { lhs: 'x7', op: '~~', rhs: 'x8', mi: 24, sepc: 1.2, group: 'Grant-White' },
      'M',
      1,
    )!;
    expect(m.modifications![0].group).toBe('Grant-White');
  });

  it('replaces a covariance held at zero by a free one', () => {
    const fixed = {
      ...hs,
      correlations: [{ id: 'k0', kind: 'indicator' as const, a: 'x8', b: 'x7', fixed: 0 }],
    };
    const m = freeParameter(fixed, { lhs: 'x7', op: '~~', rhs: 'x8', mi: 34, sepc: 0.86 }, 'M', 1)!;
    expect(m.correlations).toHaveLength(1);
    expect(m.correlations![0]).not.toHaveProperty('fixed');
  });

  it('returns null for what the canvas cannot draw or already has', () => {
    const drawn = {
      ...hs,
      correlations: [{ id: 'k', kind: 'indicator' as const, a: 'x8', b: 'x7' }],
    };
    expect(
      freeParameter(drawn, { lhs: 'x7', op: '~~', rhs: 'x8', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
    expect(
      freeParameter(hs, { lhs: 'x1', op: '~~', rhs: 'visual', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
    expect(
      freeParameter(hs, { lhs: 'x1', op: '=~', rhs: 'x2', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
    expect(
      freeParameter(hs, { lhs: 'visual', op: '=~', rhs: 'x1', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
    expect(
      freeParameter(hs, { lhs: 'speed', op: '~', rhs: 'visual', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
    expect(
      freeParameter(hs, { lhs: 'x1', op: '~', rhs: 'visual', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
    const composite = {
      ...hs,
      constructs: [{ ...hs.constructs[0], type: 'composite' as const }, ...hs.constructs.slice(1)],
    };
    expect(
      freeParameter(composite, { lhs: 'visual', op: '=~', rhs: 'x9', mi: 1, sepc: 1 }, null, 1),
    ).toBeNull();
  });
});

describe('removals and the streak of non-significant ones', () => {
  const cb = {
    estimates: [
      {
        kind: 'path',
        lhs: 'speed',
        op: '~',
        rhs: 'visual',
        est: 0.1,
        se: 0.1,
        z: 1,
        p: 0.32,
        std: 0.1,
      },
    ],
  } as unknown as Pick<CbResult, 'estimates'>;

  it('logs a deleted path with its p in the last result', () => {
    expect(removalEntries(hs, ['p1'], cb, 9)).toEqual([
      {
        id: expect.any(String),
        kind: 'remove',
        lhs: 'speed',
        op: '~',
        rhs: 'visual',
        at: 9,
        p: 0.32,
      },
    ]);
  });

  it('logs nothing without a result, for other paths, or without a p', () => {
    expect(removalEntries(hs, ['p1'], null, 9)).toEqual([]);
    expect(removalEntries(hs, ['other'], cb, 9)).toEqual([]);
    const noP = { estimates: [{ ...cb.estimates[0], p: null }] } as Pick<CbResult, 'estimates'>;
    expect(removalEntries(hs, ['p1'], noP, 9)).toEqual([]);
  });

  const rm = (p: number) => entry({ kind: 'remove', op: '~', p, mi: undefined, sepc: undefined });

  it('counts the trailing deletions of non-significant paths', () => {
    expect(removalStreak(undefined)).toBe(0);
    expect(removalStreak([])).toBe(0);
    expect(removalStreak([rm(0.4)])).toBe(1);
    expect(removalStreak([rm(0.4), rm(0.05), rm(0.7)])).toBe(3);
  });

  it('a significant deletion or a freed parameter ends the run', () => {
    expect(removalStreak([rm(0.4), rm(0.01), rm(0.6)])).toBe(1);
    expect(removalStreak([rm(0.4), entry(), rm(0.6), rm(0.2)])).toBe(2);
    expect(removalStreak([rm(0.4), rm(0.6), entry()])).toBe(0);
  });

  it('warns from the second successive deletion on, citing MacCallum et al. (1992)', () => {
    expect(removalWarning([rm(0.4)])).toBeNull();
    const w = removalWarning([rm(0.4), rm(0.5)]);
    expect(w).toMatch(/deleted 2 non-significant paths/);
    expect(w).toMatch(/MacCallum, Roznowski & Necowitz 1992/);
  });

  it('appends and caps the log', () => {
    const many = Array.from({ length: MAX_MODIFICATIONS }, (_, i) => entry({ id: `h${i}` }));
    const out = appendModifications(many, [entry({ id: 'last' })]).modifications!;
    expect(out).toHaveLength(MAX_MODIFICATIONS);
    expect(out.at(-1)!.id).toBe('last');
    expect(out[0].id).toBe('h1');
    expect(appendModifications(undefined, [])).toEqual({});
  });

  it('describes entries in words', () => {
    expect(describeModification(entry())).toBe(
      'Freed the covariance x7 ↔ x8 (MI = 34.10, SEPC = 0.86)',
    );
    expect(describeModification(rm(0.3123))).toBe('Deleted the path x8 → x7, p = .312');
    expect(describeModification(entry({ op: '=~', lhs: 'visual', rhs: 'x9', group: 'A' }))).toBe(
      'Freed the cross-loading visual → x9 (MI = 34.10, SEPC = 0.86) (suggested in group A)',
    );
  });
});

describe('deleting paths in the store', () => {
  const s = () => useStore.getState();
  const cbResult = (p: number) =>
    ({
      estimates: [
        { kind: 'path', lhs: 'B', op: '~', rhs: 'A', est: 0.1, se: 0.1, z: 1, p, std: 0.1 },
      ],
    }) as unknown as CbResult;
  beforeEach(() => {
    useStore.setState({ model: emptyModel(), past: [], future: [], toasts: [] });
    s().setSettings({ method: 'cbsem' });
  });

  function twoPaths() {
    const a = s().addConstruct(0, 0, ['a1']);
    const b = s().addConstruct(300, 0, ['b1']);
    const c = s().addConstruct(600, 0, ['c1']);
    s().setProjectName('t');
    s().commit((m) => ({
      ...m,
      constructs: m.constructs.map((k, i) => ({ ...k, name: ['A', 'B', 'C'][i] })),
    }));
    s().addPath(a, b);
    s().addPath(a, c);
    return s().model.paths.map((p) => p.id);
  }

  it('logs a non-significant deletion in the same undo step, and warns on the second', () => {
    const [ab, ac] = twoPaths();
    useStore.setState({ results: { cb: cbResult(0.4) } as never });
    s().deleteItems([], [ab]);
    expect(s().model.modifications).toHaveLength(1);
    expect(s().model.modifications![0]).toMatchObject({
      kind: 'remove',
      lhs: 'B',
      rhs: 'A',
      p: 0.4,
    });
    expect(s().toasts).toEqual([]);
    s().undo();
    expect(s().model.modifications).toBeUndefined();
    s().deleteItems([], [ab]);
    useStore.setState({
      results: {
        cb: {
          estimates: [{ kind: 'path', lhs: 'C', op: '~', rhs: 'A', p: 0.6 }],
        },
      } as never,
    });
    s().deleteItems([], [ac]);
    expect(s().model.modifications).toHaveLength(2);
    expect(s().toasts.at(-1)?.text).toMatch(/deleted 2 non-significant paths/);
  });

  it('logs nothing outside CB-SEM', () => {
    const [ab] = twoPaths();
    s().setSettings({ method: 'pls' });
    useStore.setState({ results: { cb: cbResult(0.4) } as never });
    s().deleteItems([], [ab]);
    expect(s().model.modifications).toBeUndefined();
  });
});
