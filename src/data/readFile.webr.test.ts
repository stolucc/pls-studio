// SPSS, Stata and Excel import through R (haven, readxl) in webR. References:
// the packages' own example files against R's datasets::iris and mtcars, and
// files written by haven in the same session (value labels, user-missing
// values, factors, text). Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import commonR from '../rengine/R/common.R?raw';
import { callJson, withR } from '../rengine/runtime';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { readPackageFile, toDataset, type RawDataFile } from './readFile';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const inR = <T>(code: string) =>
  withR(['jsonlite', 'haven', 'readxl'], { common: commonR }, (webR) =>
    callJson(webR, code, null),
  ) as Promise<T>;
const col = (d: { names: string[]; cols: Float64Array[] }, n: string) => [
  ...d.cols[d.names.indexOf(n)],
];

describe('example files shipped with the packages', () => {
  it('haven’s iris.sav equals datasets::iris', async () => {
    const { data, info } = await readPackageFile('haven', 'examples/iris.sav', 'sav');
    const iris = await inR<Record<string, number[]>>('ps_json(as.list(datasets::iris[1:4]))');
    expect(info.rows).toBe(150);
    for (const [k, v] of Object.entries(iris)) {
      const name = data.names.find((n) => n.replace(/_/g, '.').toLowerCase() === k.toLowerCase())!;
      expect(name, k).toBeDefined();
      col(data, name).forEach((x, i) => expect(x).toBeCloseTo(v[i], 10));
    }
  }, 900_000);

  it('readxl’s datasets.xlsx: sheets listed; mtcars (the first) equals datasets::mtcars, chickwts’s feed becomes categories', async () => {
    const { data, sheets } = await readPackageFile('readxl', 'extdata/datasets.xlsx', 'xlsx');
    expect(sheets).toEqual(['mtcars', 'chickwts', 'quakes']);
    const mt = await inR<Record<string, number[]>>('ps_json(as.list(datasets::mtcars))');
    expect(data.names).toEqual(Object.keys(mt));
    for (const [k, v] of Object.entries(mt)) expect(col(data, k)).toEqual(v);
    const chick = await readPackageFile('readxl', 'extdata/datasets.xlsx', 'xlsx', 'chickwts');
    expect(chick.data.categories?.feed).toEqual([
      'casein',
      'horsebean',
      'linseed',
      'meatmeal',
      'soybean',
      'sunflower',
    ]);
    expect(col(chick.data, 'weight')).toEqual(
      await inR<number[]>('ps_json(datasets::chickwts$weight)'),
    );
  }, 900_000);

  it('refuses paths outside a package and unknown formats', async () => {
    await expect(readPackageFile('haven', '../../etc/passwd', 'sav')).rejects.toThrow(
      'Invalid example file',
    );
    await expect(readPackageFile('haven', 'examples/iris.sav', 'csv' as never)).rejects.toThrow(
      'Unsupported file type',
    );
  }, 900_000);
});

describe('files from users', () => {
  it('SPSS and Stata: labelled numbers stay numbers, user-missing values are missing, factors and text become categories', async () => {
    // Written by haven, then read back through the upload path (bytes as base64).
    const files = await inR<{ sav: string; dta: string }>(`
      d <- data.frame(item = haven::labelled_spss(c(1, 2, 5, 9, 3), c(disagree = 1, agree = 5, refused = 9), na_values = 9),
                      group = factor(c("b", "a", "b", "a", "b"), levels = c("b", "a")),
                      town = c("Cork", "Kerry", NA, "Cork", "Kerry"),
                      when = as.Date("2020-01-01") + 0:4)
      f1 <- tempfile(fileext = ".sav"); haven::write_sav(d, f1)
      f2 <- tempfile(fileext = ".dta"); d2 <- d; d2$item <- haven::zap_missing(d2$item); haven::write_dta(d2, f2)
      b64 <- function(f) jsonlite::base64_enc(readBin(f, "raw", file.size(f)))
      ps_json(list(sav = b64(f1), dta = b64(f2)))`);
    for (const format of ['sav', 'dta'] as const) {
      const raw = await inR<RawDataFile>(
        `ps_read_data(jsonlite::toJSON(list(format = "${format}", data = "${files[format]}"), auto_unbox = TRUE))`,
      );
      const { data, info } = toDataset(raw, `x.${format}`);
      expect(
        col(data, 'item').map((v) => (Number.isNaN(v) ? null : v)),
        format,
      ).toEqual([1, 2, 5, null, 3]);
      expect(data.categories?.town).toEqual(['Cork', 'Kerry']);
      expect(col(data, 'town').map((v) => (Number.isNaN(v) ? null : v))).toEqual([
        1,
        2,
        null,
        1,
        2,
      ]);
      expect(info.excluded.map((x) => x.name)).toEqual(['when']);
      // SPSS stores the factor as labelled codes: numbers (1 = b, 2 = a); Stata the same.
      expect(col(data, 'group')).toEqual([1, 2, 1, 2, 1]);
      // haven's value labels come along as the columns' value labels.
      const labels = (n: string) => info.variables?.find((v) => v.name === n)?.labels;
      expect(labels('item'), format).toEqual([
        { value: 1, label: 'disagree' },
        { value: 5, label: 'agree' },
        { value: 9, label: 'refused' },
      ]);
      expect(labels('group'), format).toEqual([
        { value: 1, label: 'b' },
        { value: 2, label: 'a' },
      ]);
    }
  }, 900_000);
});
