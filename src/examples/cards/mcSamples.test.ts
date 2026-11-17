// The diagram sample of every Monte Carlo card is a draw from the card's own population: a likelihood-ratio test
// of the sample covariance matrix against the population's indicator covariance matrix does not reject it.
// (lavaan::simulateData(standardized = TRUE) leaves endogenous latent residual variances at 1, so samples made
// from a structural model that way came from a population with smaller standardized paths.)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../engine/dataset';
import { cholesky, invertPD, logDetPD, type Mat } from '../../engine/linalg';
import { buildPopulation, withPathValues, type PopulationSpec } from '../../engine/population';
import { chisqCdf } from '../../engine/stats';
import { PACKAGE_EXAMPLES } from '../packages';

const ROOT = join(__dirname, '..', '..', '..');

interface McPanel {
  kind: 'mc';
  population: PopulationSpec;
  groups?: { paths: { from: string; to: string; value: number }[] };
}

const covariance = (rows: number[][]): Mat => {
  const n = rows.length;
  const p = rows[0].length;
  const mean = Array.from({ length: p }, (_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
  return Array.from({ length: p }, (_, i) =>
    Array.from(
      { length: p },
      (_, j) => rows.reduce((s, r) => s + (r[i] - mean[i]) * (r[j] - mean[j]), 0) / (n - 1),
    ),
  );
};

/** p value of the test that rows come from a normal population with covariance matrix Sigma. */
const lrTest = (rows: number[][], Sigma: Mat): number => {
  const S = covariance(rows);
  const p = S.length;
  const L = cholesky(Sigma)!;
  const inv = invertPD(L);
  let trace = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) trace += S[i][j] * inv[j][i];
  const T = (rows.length - 1) * (logDetPD(L) - logDetPD(cholesky(S)!) + trace - p);
  return 1 - chisqCdf(T, (p * (p + 1)) / 2);
};

const CARDS = PACKAGE_EXAMPLES.filter(
  (e) => (e.panel as { kind?: string } | undefined)?.kind === 'mc' && e.data.file,
).map((e) => ({ id: e.id, file: e.data.file!, panel: e.panel as unknown as McPanel }));

describe('Monte Carlo diagram samples', () => {
  it('cover the simulation cards', () => {
    expect(CARDS.length).toBeGreaterThan(40);
  });

  it.each(CARDS.map((c) => [c.id, c] as const))(
    '%s: the sample is a draw from the card’s population',
    (_id, { file, panel }) => {
      const pop = buildPopulation(panel.population);
      // Non-normal data: the normal-theory test would reject for the kurtosis alone.
      if (pop.vm) return;
      const parsed = parseCsv(readFileSync(join(ROOT, 'public', file), 'utf8'));
      const { names, cols } = parsed.dataset;
      const column = (name: string) => cols[names.indexOf(name)];
      const groupColumn = names.includes('group') ? column('group') : null;
      const rowsOf = (group: number | null) =>
        Array.from({ length: parsed.rows }, (_, i) => i)
          .filter((i) => group === null || groupColumn![i] === group)
          .map((i) => pop.names.map((name) => column(name)[i]));
      expect(lrTest(rowsOf(groupColumn ? 1 : null), pop.Sigma), file).toBeGreaterThan(1e-4);
      if (panel.groups) {
        const second = buildPopulation(withPathValues(panel.population, panel.groups.paths));
        expect(lrTest(rowsOf(2), second.Sigma), `${file}, group 2`).toBeGreaterThan(1e-4);
      }
    },
  );
});
