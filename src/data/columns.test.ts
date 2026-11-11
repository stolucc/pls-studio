import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { columnsFingerprint } from '../analyses/common';
import type { AnalysisCtx } from '../analyses/types';
import { contingencyRequest } from '../rengine/tests';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type DataInfo,
  type ModelState,
} from '../model/project';
import { computeColumn, removeComputed } from './compute';
import {
  labelOf,
  levelOf,
  parseLabelsText,
  parseVariables,
  setVariableInfo,
  suggestedLevel,
  withLabelledCategories,
} from './columns';
import { ordinalSuggestions } from '../components/inspector/OrdinalSuggestion';

const data: Dataset = {
  names: ['sex', 'likert', 'income', 'town'],
  cols: [
    Float64Array.from([0, 1, 1, 0, NaN]),
    Float64Array.from([1, 2, 5, 4, 3]),
    Float64Array.from([10.5, 20, 30, 40, 50]),
    Float64Array.from([1, 2, 1, 2, 1]),
  ],
  categories: { town: ['Cork', 'Kerry'] },
};
const info: DataInfo = { fileName: 'd.csv', rows: 5, missingCells: 1, excluded: [] };
const model: ModelState = { constructs: [], paths: [], moderations: [] };

describe('measurement levels', () => {
  it('are suggested by the values and can be set', () => {
    expect(suggestedLevel(data, 'sex')).toBe('nominal');
    expect(suggestedLevel(data, 'likert')).toBe('ordinal');
    expect(suggestedLevel(data, 'income')).toBe('scale');
    expect(suggestedLevel(data, 'town')).toBe('nominal');
    const set = setVariableInfo(info, 'income', { level: 'ordinal' });
    expect(levelOf(data, set, 'income')).toBe('ordinal');
    const back = setVariableInfo(set, 'income', { level: null });
    expect(back.variables).toBeUndefined();
    expect(levelOf(data, back, 'income')).toBe('scale');
  });

  it('suggest ordinal indicators for CB-SEM when set to ordinal', () => {
    const m: ModelState = {
      ...model,
      constructs: [
        {
          id: 'c',
          name: 'C',
          indicators: ['likert', 'income', 'sex'],
        } as ModelState['constructs'][0],
      ],
      ordered: ['sex'],
    };
    let i = setVariableInfo(info, 'likert', { level: 'ordinal' });
    i = setVariableInfo(i, 'sex', { level: 'ordinal' });
    expect(ordinalSuggestions(m, i)).toEqual(['likert']);
    expect(ordinalSuggestions(m, info)).toEqual([]);
  });
});

describe('value labels', () => {
  it('are typed one per line and validated', () => {
    expect(parseLabelsText('2 = High\n\n 1: Low \n-9 = refused')).toEqual([
      { value: -9, label: 'refused' },
      { value: 1, label: 'Low' },
      { value: 2, label: 'High' },
    ]);
    expect(() => parseLabelsText('1 = a\n1 = b')).toThrow(/two labels/);
    expect(() => parseLabelsText('low = 1')).toThrow(/write a value/);
    expect(() => parseLabelsText(`1 = ${'x'.repeat(201)}`)).toThrow(/too long/);
  });

  it('name the categories of grouping columns in analyses', () => {
    const i = setVariableInfo(info, 'sex', {
      labels: [
        { value: 1, label: 'female' },
        { value: 0, label: 'male' },
      ],
    });
    expect(labelOf(i, 'sex', 1)).toBe('female');
    const d = withLabelledCategories(data, i, ['sex', 'likert', 'town']);
    expect(d.categories).toEqual({ town: ['Cork', 'Kerry'], sex: ['male', 'female'] });
    expect(Array.from(d.cols[0])).toEqual([1, 2, 2, 1, NaN]);
    // Unlabelled columns are left as they are.
    expect(d.cols[1]).toBe(data.cols[1]);
    const req = contingencyRequest(d, {
      rows: 'sex',
      columns: 'town',
      counts: '',
      confidence: 0.95,
    });
    expect(req.categories).toEqual({ sex: ['male', 'female'], town: ['Cork', 'Kerry'] });
    // A value without a label is named by its number.
    const partial = setVariableInfo(info, 'likert', { labels: [{ value: 5, label: 'top' }] });
    expect(withLabelledCategories(data, partial, ['likert']).categories?.likert).toEqual([
      '1',
      '2',
      '3',
      '4',
      'top',
    ]);
  });

  it('make a result stale when they change', () => {
    const ctx = (i: DataInfo) =>
      ({ data, info: i, settings: DEFAULT_SETTINGS, pls: null, projectName: '' }) as AnalysisCtx;
    const plain = columnsFingerprint(ctx(info), ['sex']);
    const labelled = setVariableInfo(info, 'sex', { labels: [{ value: 1, label: 'f' }] });
    expect(columnsFingerprint(ctx(labelled), ['sex'])).not.toBe(plain);
    expect(columnsFingerprint(ctx(labelled), ['income'])).toBe(
      columnsFingerprint(ctx(info), ['income']),
    );
  });

  it('go with a computed column when it is removed', () => {
    const c = computeColumn(data, info, 'hi', 'income > 25');
    const l = { ...c, info: setVariableInfo(c.info, 'hi', { labels: [{ value: 1, label: 'y' }] }) };
    expect(removeComputed(l.data, l.info, 'hi').info.variables).toBeUndefined();
  });
});

describe('column information in project files', () => {
  it('is saved and read back', () => {
    let i = setVariableInfo(info, 'sex', { level: 'nominal', labels: [{ value: 1, label: 'f' }] });
    i = setVariableInfo(i, 'town', { level: 'ordinal' });
    const file = parseProject(serializeProject(model, DEFAULT_SETTINGS, data, i));
    expect(file.info!.variables).toEqual(i.variables);
  });

  it('is validated strictly', () => {
    expect(
      parseVariables(
        [
          { name: 'sex', level: 'interval', labels: [{ value: 1, label: ' f ' }] },
          { name: 'sex', level: 'nominal' },
          { name: 'gone', level: 'scale' },
          { name: 'town', level: 'ordinal', labels: [{ value: 1, label: 'not for text' }] },
          {
            name: 'likert',
            labels: [
              { value: Infinity, label: 'x' },
              { value: 2, label: '' },
              { value: 1, label: 7 },
              { value: 3, label: 'ok' },
              { value: 3, label: 'twice' },
            ],
          },
          { name: 'income' },
          'junk',
        ],
        data,
      ),
    ).toEqual([
      { name: 'sex', labels: [{ value: 1, label: 'f' }] },
      { name: 'town', level: 'ordinal' },
      { name: 'likert', labels: [{ value: 3, label: 'ok' }] },
    ]);
    expect(parseVariables({ sex: 'nominal' }, data)).toBeUndefined();
  });
});
