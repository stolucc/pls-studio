// sampleselection-mroz against ?selection's own code run verbatim in the same R:
// kids = kids5 + kids618 > 0, heckit() (two-step) and selection() (maximum
// likelihood) with age², experience². Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { computeColumn } from '../data/compute';
import { rCall } from '../rengine/bridge';
import { endoR, type EndoInput } from '../rengine/endo';
import commonR from '../rengine/R/common.R?raw';
import { callJson, withR } from '../rengine/runtime';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import type { DataInfo } from '../model/project';
import { PACKAGE_EXAMPLES } from './packages';
import { against, example as exampleCheck } from '../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('sampleselection-mroz: the two-step and the ML estimates equal the help page’s heckit() and selection()', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'sampleselection-mroz')!;
  exampleCheck(ex.id, { title: ex.title, method: 'Regression', packages: [ex.package], definition: ex });
  against({ label: 'sampleSelection, ?selection: heckit() and selection() run verbatim in the same R', level: 'native' });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'sampleSelection', name: 'Mroz87', na: [] }, 'sampleSelection');
  let data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  let info: DataInfo = { fileName: 'x', rows: data.cols[0].length, missingCells: 0, excluded: [] };
  for (const k of ex.computed!) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const { kind: _k, ...p } = ex.panel as Record<string, unknown>;
  const base = { endogenous: [], instruments: [], hetRegressors: [], hmTypes: [], boot: { samples: 200, seed: 1, confidence: 0.95 } };
  const input = { ...base, ...p } as unknown as EndoInput;
  const two = await endoR(data, input);
  const ml = await endoR(data, { ...input, heckmanMethod: 'ml' });
  const ref = await withR(['jsonlite', 'sampleSelection'], { common: commonR }, (webR) => callJson(webR, `suppressPackageStartupMessages(library(sampleSelection))
    data(Mroz87)
    Mroz87$kids  <- ( Mroz87$kids5 + Mroz87$kids618 > 0 )
    a <- summary( heckit( lfp ~ age + I( age^2 ) + faminc + kids + educ, wage ~ exper + I( exper^2 ) + educ + city, Mroz87 ) )$estimate
    b <- summary( selection( lfp ~ age + I( age^2 ) + faminc + kids + educ, wage ~ exper + I( exper^2 ) + educ + city, Mroz87 ) )$estimate
    ps_json(list(two = unname(a[, 1]), twoSe = unname(a[, 2]), ml = unname(b[, 1]), mlSe = unname(b[, 2])))`, null)) as { two: number[]; twoSe: number[]; ml: number[]; mlSe: number[] };
  expect(two.coefficients.map((x) => x.est)).toHaveLength(ref.two.length);
  ref.two.forEach((v, i) => { const t = two.coefficients[i].term; expect(two.coefficients[i].est, `two-step: ${t}`).toBeCloseTo(v, 8); expect(two.coefficients[i].se!, `two-step: SE of ${t}`).toBeCloseTo(ref.twoSe[i], 8); });
  ref.ml.forEach((v, i) => { const t = ml.coefficients[i].term; expect(ml.coefficients[i].est, `ML: ${t}`).toBeCloseTo(v, 6); expect(ml.coefficients[i].se!, `ML: SE of ${t}`).toBeCloseTo(ref.mlSe[i], 6); });
  expect(two.selection).toEqual({ selected: 428, total: 753 });
}, 900_000);
