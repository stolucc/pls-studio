// The Mplus User's Guide examples (Muthén & Muthén): generated data published with each example, shipped with the
// app (public/examples/mplus, converted by scripts/validation/mplus_data.py), with Mplus's defaults (mean structure,
// observed information, geomin epsilon). The tests compare each with the numbers its Mplus output prints
// (scripts/validation/mplus_printed.py, src/engine/__fixtures__/textbook/mplus_printed.json).

import type { RegressionOptions } from '../../analyses/regression';
import type { ExamplePackage } from '../packages';

/** The guide's page for one example and its chapter's inputs, data and outputs. */
export const mplusLinks = (ex: string) => [
  { label: `Mplus User’s Guide, example ${ex}`, url: `https://www.statmodel.com/usersguide/chap${ex.split('.')[0]}/ex${ex}.html` },
  { label: `Chapter ${ex.split('.')[0]}: inputs, data and outputs`, url: `https://www.statmodel.com/usersguide/chapter${ex.split('.')[0]}.shtml` },
];
export const mplusData = (ex: string, pkg: ExamplePackage = 'lavaan') => ({ package: pkg, name: `Mplus example ${ex}`, file: `examples/mplus/ex${ex}.csv` });
export const MPLUS_TAG = 'Mplus User’s Guide';
export const MPLUS_SRC = (ex: string) => `Mplus User’s Guide (Muthén & Muthén 2017), example ${ex}`;
export const regression = (family: RegressionOptions['family'], link: string, outcome: string, predictors: string[]) =>
  ({ kind: 'regression' as const, family, link, outcome, predictors, categorical: [], interactions: [], trials: '', weights: '', se: 'model' as RegressionOptions['se'], cluster: '' });
