// The nonparametric tests of the basic-statistics cards (R/nonparametric.R) against base R
// and the packages that implement them (DescTools, dunn.test, PMCMRplus in desktop R) on the
// same data (scripts/validation/nonparametric.R). Run natively with WEBR_TESTS=1 PS_NATIVE_R=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near } from '../validation/record';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import { contingencyR } from './tests';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'nonparametric', 'reference.json'),
    'utf8',
  ),
) as Record<string, any>;

/** A reference frame as a dataset (missing values come as null in JSON). */
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c, (x) => (x === null ? NaN : x))),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});

// Closed forms on the same data: 1e-6 relative allows for webR's WebAssembly floating point.
const close = (what: string, a: number | null | undefined, b: number) =>
  near(what, a ?? NaN, b, 1e-6 * Math.max(1, Math.abs(b)));

describe('paired contingency tables', () => {
  it('McNemar’s test of Agresti’s approval table: asymptotic, continuity-corrected, exact', async () => {
    const r = await contingencyR(data(ref.performance), {
      rows: 'first',
      columns: 'second',
      counts: 'count',
      confidence: 0.95,
      paired: true,
    });
    const p = r.paired!;
    const m = ref.mcnemar;
    close('McNemar χ²', p.mcnemar!.stat, m.plain.stat);
    close('McNemar p', p.mcnemar!.p, m.plain.p);
    close('McNemar χ², continuity correction', p.mcnemarCorrected!.stat, m.corrected.stat);
    close('McNemar p, continuity correction', p.mcnemarCorrected!.p, m.corrected.p);
    close('exact p', p.exact!.p, m.exactP);
    near('discordant b', p.exact!.b, 150, 0);
    near('discordant c', p.exact!.c, 86, 0);
  }, 600_000);

  it('Bowker’s test of symmetry: equal to mcnemar.test, and with an empty pair of cells left out', async () => {
    const input = {
      rows: 'before',
      columns: 'after',
      counts: 'count',
      confidence: 0.95,
      paired: true as const,
    };
    const full = (await contingencyR(data(ref.bowkerFull), input)).paired!.bowker!;
    close('Bowker χ² (mcnemar.test)', full.stat, ref.bowker.full.stat);
    near('Bowker df (mcnemar.test)', full.df, ref.bowker.full.df, 0);
    close('Bowker p (mcnemar.test)', full.p, ref.bowker.full.p);
    const empty = (await contingencyR(data(ref.bowkerEmpty), input)).paired!.bowker!;
    close('Bowker χ², an empty pair', empty.stat, ref.bowker.empty.stat);
    near('Bowker df, an empty pair', empty.df, ref.bowker.empty.df, 0);
    close('Bowker p, an empty pair', empty.p, ref.bowker.empty.p);
  }, 600_000);
});
