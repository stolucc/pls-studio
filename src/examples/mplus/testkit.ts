// Shared by the Mplus chapter tests (chN.webr.test.ts): the printed Mplus output of each example
// (scripts/validation/mplus_printed.py, from the statmodel.com output pages), the data (see load), and
// comparisons that record validation evidence. Mplus prints three decimals and stops at a looser
// convergence criterion than lavaan, so values agree within 0.001 unless a test says otherwise.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { PACKAGE_EXAMPLES } from '../packages';
import { DATA_CACHE, exampleTestData } from '../testData';
import { against, example as exampleCheck, near, same } from '../../validation/record';

/** One parameter of MODEL RESULTS: `block` is the heading it is printed under (a group, latent class or level), `group` the group's number in print order. */
export type Printed = { lhs: string; op: string; rhs: string; group: number; block: string; est: number; se: number };
export type Fit = { npar?: number; logl?: number; aic?: number; bic?: number; chisq?: number; df?: number };
export const MPLUS = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'textbook', 'mplus_printed.json'), 'utf8')) as Record<string, { fit: Fit; estimates: Printed[] }>;
/** Mplus's three printed decimals plus its convergence criterion. */
export const TOL = 0.001;

export const example = (key: string) => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === `mplus-${key}`);
  if (!ex) throw new Error(`No example mplus-${key}`);
  return ex;
};
/** Start the example's validation evidence: the Mplus output it is compared with. */
export const evidence = (key: string, method: string, packages: string[]) => {
  const ex = example(key);
  exampleCheck(ex.id, { title: ex.title, method, packages, definition: ex });
  against({ label: `Mplus User’s Guide, example ${key.slice(2)}: the printed output (statmodel.com)`, url: 'https://www.statmodel.com/ugexcerpts.shtml', level: 'published' });
};
/**
 * The example's data, as opening it gives them. The Mplus data are not shipped with the app (no licence is stated):
 * tests read them from the local cache .cache/mplus/ (not in git), which npm run data:fetch fills from statmodel.com
 * with the app's own conversion; reshapes (ex6.19, ex9.16) are applied in code, as the app applies them.
 */
export const MPLUS_CACHE = join(DATA_CACHE, 'mplus');
export const load = (key: string) => {
  const d = exampleTestData(example(key));
  if (!d) throw new Error(`mplus-${key} has no data file`);
  return d;
};
export type Mine = { lhs: string; op: string; rhs: string; est: number; se: number | null; kind?: string };

/**
 * Every parameter Mplus prints: a free one (SE > 0) must be in the app's table with the same estimate
 * and (unless `ses` is false) standard error; a fixed one, when the app lists it, at the same value.
 */
export function samePrinted(mine: Mine[], printed: Printed[], where: string, opts: { tol?: number; seTol?: number; ses?: boolean; skip?: (p: Printed) => boolean } = {}) {
  const tol = opts.tol ?? TOL;
  for (const p of printed) {
    if (opts.skip?.(p)) continue;
    const pool = mine.filter((e) => (e.op === p.op || (p.op === '|' && e.kind === 'threshold'))
      && ((e.lhs === p.lhs && e.rhs === p.rhs) || (p.op === '~~' && e.lhs === p.rhs && e.rhs === p.lhs)));
    const what = `${where}: ${p.lhs} ${p.op} ${p.rhs} (group ${p.group})`;
    const label = `${p.lhs} ${p.op} ${p.rhs}${p.group > 1 || where.includes('group') ? ` (group ${p.group})` : ''}`;
    if (p.se === 0) {
      if (pool.length) near(`${label} (fixed)`, pool.reduce((a, b) => (Math.abs(b.est - p.est) < Math.abs(a.est - p.est) ? b : a)).est, p.est, tol);
      continue;
    }
    expect(pool.length, `${what} is not in the app's table`).toBeGreaterThan(0);
    const best = pool.reduce((a, b) => (Math.abs(b.est - p.est) < Math.abs(a.est - p.est) ? b : a));
    near(label, best.est, p.est, tol);
    if (opts.ses !== false) near(`SE of ${label}`, best.se ?? 0, p.se, opts.seTol ?? tol);
  }
}

export function sameFit(fit: Partial<Record<'npar' | 'logl' | 'aic' | 'bic' | 'chisq' | 'df', number | undefined>>, want: Fit) {
  if (want.npar !== undefined) same('free parameters', fit.npar!, want.npar);
  if (want.df !== undefined) same('df', fit.df!, want.df);
  const label = { logl: 'log-likelihood', aic: 'AIC', bic: 'BIC', chisq: 'χ²' } as const;
  for (const k of ['logl', 'aic', 'bic', 'chisq'] as const) if (want[k] !== undefined) near(label[k], fit[k]!, want[k]!, 0.002);
}

/** Run each card the example opens (panel, then morePanels) through its card's own run(), on the example's data. */
export async function runCards<R = unknown>(key: string): Promise<R[]> {
  const { analysisType } = await import('../../analyses/registry');
  const { examplePanels, exampleSettings, panelPreset } = await import('../packages');
  const { DEFAULT_SETTINGS } = await import('../../model/project');
  const { computeColumn } = await import('../../data/compute');
  const ex = example(key);
  let data = load(key);
  // (the example's computed columns, as the app adds them when the example opens)
  let info = { fileName: key, rows: data.cols[0]?.length ?? 0, missingCells: 0, excluded: [] } as unknown as Parameters<typeof computeColumn>[1];
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const ctx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title };
  const out: R[] = [];
  for (const p of examplePanels(ex)) {
    const t = analysisType(p.kind)!;
    const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(p) });
    expect(t.blocked(options, ctx), `${key}: ${p.kind} is ready to run`).toBeNull();
    out.push(await t.run(options, ctx, () => {}) as R);
  }
  return out;
}
