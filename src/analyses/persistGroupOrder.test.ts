// Models kept in cards (model runs, a model comparison's alternative) from projects saved before
// format 3: their values per group were in lavaan's order, like the project's own model, and are
// migrated the same way (model/project.ts migrateGroupValues), exactly once.

import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { projectCards } from '../io';
import {
  DEFAULT_SETTINGS,
  migrateGroupValues,
  parseProject,
  serializeProject,
  type ModelState,
  type Settings,
} from '../model/project';
import { parseLavaanSyntax } from '../model/syntax';
import type { CompareModelsOptions } from './cbDiag';
import { parseCards } from './persist';
import { runData, runHash, type RunOptions } from './runHash';
import type { AnalysisCard, Card } from './types';

// Groups 3, 1, 2 in the order they first appear in the rows (as model/groupValueOrder.test.ts).
const data: Dataset = {
  names: ['x1', 'x2', 'x3', 'g'],
  cols: [
    Float64Array.from([1, 2, 3, 4, 5, 6]),
    Float64Array.from([2, 1, 4, 3, 6, 5]),
    Float64Array.from([3, 3, 1, 1, 2, 2]),
    Float64Array.from([3, 1, 2, 3, 1, 2]),
  ],
};
// The same groups, first appearing as 1, 2, 3: other data (another fingerprint, another order).
const otherData: Dataset = {
  names: ['x1', 'x2', 'x3', 'g'],
  cols: [
    Float64Array.from([2, 3, 1, 5, 6, 4]),
    Float64Array.from([1, 4, 2, 6, 5, 3]),
    Float64Array.from([3, 1, 3, 2, 2, 1]),
    Float64Array.from([1, 2, 3, 1, 2, 3]),
  ],
};
const info = { fileName: 'd.csv', rows: 6, missingCells: 0, excluded: [] };
const settings: Settings = { ...DEFAULT_SETTINGS, method: 'cbsem' };

// A model as projects before format 3 stored it: values per group in lavaan's order, unmarked.
const SYNTAX = 'f =~ x1 + x2 + x3\nf ~~ c(0.5, NA, 2)*f\nf ~ c(NA, 0, NA)*1';
const { groupValueOrder: _marker, ...parsedSyntax } = parseLavaanSyntax(SYNTAX).model;
const stored: ModelState = {
  ...parsedSyntax,
  multigroup: { column: 'g', invariance: 'configural', free: [] },
};
// Group 3 has 0.5, group 1 NA, group 2 2: in the order of the codes 1, 2, 3.
const APPEARANCE = [0.5, null, 2];
const CODE_ORDER = [null, 2, 0.5];

const variance = (m: ModelState) => m.parameters!.find((t) => t.kind === 'variance')!.byGroup;

/** A model-run card as the app saved it, its data and hash as they were then. */
function runCard(id: string, model: ModelState, used: Dataset): Card {
  const run = runData(used, info);
  const options: RunOptions = {
    label: 'Model v1',
    version: 1,
    hash: runHash(model, settings, run),
    model,
    settings,
    data: run,
    changes: [],
  };
  return { id, kind: 'analysis', type: 'run', options };
}

function compareCard(model: ModelState): Card {
  const options: CompareModelsOptions = {
    alternative: { model, savedAt: 1 },
    nested: 'auto',
  };
  return { id: 'card-compare', kind: 'analysis', type: 'cbmodels', options };
}

/** A project file of the given format with its data and cards. */
function file(version: number, cards: Card[]): string {
  const json = JSON.parse(serializeProject(stored, settings, data, info, null, cards));
  return JSON.stringify({ ...json, version });
}

/** Open a project file as the app does (io.ts): the model, then the cards with the file's format and data. */
function open(text: string) {
  const p = parseProject(text);
  return { p, cards: projectCards(p) };
}

const options = <T>(cards: Card[], id: string) =>
  (cards.find((c) => c.id === id) as AnalysisCard).options as T;

const OLD_CARDS = [
  runCard('card-run', stored, data),
  runCard('card-other', stored, otherData),
  compareCard(stored),
];

describe('cards in a project saved before format 3', () => {
  it('get their values per group in code order, like the project model', () => {
    const { p, cards } = open(file(2, OLD_CARDS));
    expect(variance(p.model)).toEqual(CODE_ORDER);
    expect(p.model.groupValueOrder).toBeUndefined();

    const run = options<RunOptions>(cards, 'card-run');
    expect(variance(run.model)).toEqual(CODE_ORDER);
    expect(run.model.groupValueOrder).toBeUndefined();
    // The version's id follows the migrated model: the project's model still is this version.
    expect(run.hash).toBe(runHash(p.model, p.settings, p.data));

    const alternative = options<CompareModelsOptions>(cards, 'card-compare').alternative!;
    expect(variance(alternative.model)).toEqual(CODE_ORDER);
    expect(alternative.model.groupValueOrder).toBeUndefined();
  });

  it('a run on other data keeps lavaan’s order, marked (its own data are not at hand)', () => {
    const { cards } = open(file(2, OLD_CARDS));
    const other = options<RunOptions>(cards, 'card-other');
    expect(variance(other.model)).toEqual(APPEARANCE);
    expect(other.model.groupValueOrder).toBe('appearance');
    expect(other.hash).toBe(runHash(other.model, other.settings, other.data));
  });

  it('saved and opened again: nothing is reordered a second time', () => {
    const first = open(file(2, OLD_CARDS));
    const text = serializeProject(
      first.p.model,
      first.p.settings,
      first.p.data,
      first.p.info,
      null,
      first.cards,
    );
    const second = open(text);
    expect(second.p.model).toEqual(first.p.model);
    expect(second.cards).toEqual(first.cards);
    // (and once more)
    expect(open(text).cards).toEqual(first.cards);
  });

  it('parsing the same cards twice with the old format still migrates them once', () => {
    const { p, cards } = open(file(2, OLD_CARDS));
    const again = parseCards(JSON.parse(JSON.stringify(cards)), { version: 3, data: p.data });
    expect(again).toEqual(cards);
  });
});

describe('cards in a format-3 project', () => {
  it('are read as they are (values already in code order)', () => {
    const { cards } = open(file(3, OLD_CARDS));
    expect(cards).toEqual(parseCards(OLD_CARDS));
    const run = options<RunOptions>(cards, 'card-run');
    expect(variance(run.model)).toEqual(APPEARANCE);
    expect(run.model.groupValueOrder).toBeUndefined();
    expect(run.hash).toBe((OLD_CARDS[0] as AnalysisCard & { options: RunOptions }).options.hash);
  });
});

it('a later format does not mark values per group again (only formats before 3 were in lavaan’s order)', () => {
  expect(migrateGroupValues(stored, 4, data)).toBe(stored);
  expect(migrateGroupValues(stored, 3, data)).toBe(stored);
  expect(variance(migrateGroupValues(stored, 2, data))).toEqual(CODE_ORDER);
});
