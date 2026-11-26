// Shared by the webR tests of cards/model.ts (model.webr.test.ts and the Monte Carlo files model.*.webr.test.ts): each
// example opened as the app opens it, through its card, and a Monte Carlo card's design run in R.
//
// The Monte Carlo cards are split over several files so that vitest runs them side by side, each file in its own
// worker with its own R sessions, and each file records its evidence when it ends: one slow card no longer holds up,
// or loses, the others'. The heaviest cards (a timeout of two hours or more) have a file each, so they start together.
//
// Within a card the chunks of 100 replications go to R sessions: two to start with, and one more (up to six) whenever a
// chunk ends while the machine has cores to spare, so the cards still running late use the cores the finished files
// left (PS_MC_SESSIONS=<n> fixes the number instead). Every chunk draws from its own seed (seed + start), so the results
// do not depend on how many sessions run them (rengine/parallel.webr.test.ts).

import { expect } from 'vitest';
import type { Dataset, PlsResult } from '../../engine/types';
import { designParameters, summariseMc, type McDesign, type McPart } from '../../engine/montecarlo';
import { buildPopulation } from '../../engine/population';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall, type RPackage } from '../../rengine/bridge';
import { runMcChunkR } from '../../rengine/mc';
import { cpus, loadavg } from 'node:os';
import {
  exampleModel,
  exampleSettings,
  PACKAGE_EXAMPLES,
  panelPreset,
  type PackageExample,
} from '../packages';
import { example as exampleCheck, same } from '../../validation/record';
import { exampleTestData } from '../testData';

/** R sessions a Monte Carlo card starts on, and the most it grows to (PS_MC_SESSIONS fixes both). */
const FIXED = Number(process.env.PS_MC_SESSIONS) || 0;
export const MC_SESSIONS = { start: FIXED || 2, max: FIXED || 6 };

/** Cores to spare: the machine's cores less its load over the last minute. */
const spareCores = () => cpus().length - loadavg()[0];

export const exampleOf = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!;

export async function load(ex: PackageExample): Promise<Dataset> {
  const fromFile = exampleTestData(ex);
  if (fromFile) return fromFile;
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>(
    'ps_dataset',
    { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] },
    ex.data.package as RPackage,
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
}

/** The example as the app opens it: its data, settings and diagram, and its card with the example's options. */
export async function open(
  id: string,
  method: string,
  packages: string[],
  pls?: (ctx: AnalysisCtx) => Promise<PlsResult>,
) {
  const ex = exampleOf(id);
  exampleCheck(id, { title: ex.title, method, packages, definition: ex });
  const data = await load(ex);
  const ctx: AnalysisCtx = {
    data,
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
    model: exampleModel(ex),
  };
  if (pls) ctx.pls = await pls(ctx);
  const kind = ex.panel!.kind,
    preset = panelPreset(ex.panel!);
  const t = analysisType(kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...preset })!;
  expect(t.blocked?.(options as never, ctx) ?? null, `${id}: the card is ready to run`).toBeNull();
  return {
    ex,
    data,
    ctx,
    t,
    options,
    run: <R>() => t.run(options as never, ctx, () => {}) as Promise<R>,
  };
}

/**
 * Run `items` on R sessions 0, 1, …: `start` lanes at first, a lane more (up to `max`) whenever an item ends while
 * `spare()` reports at least two cores free. Each lane keeps its session; results in the order of `items`; the first
 * failure rejects and no further items start.
 */
export async function growingMap<I, O>(
  items: I[],
  run: (item: I, session: number) => Promise<O>,
  { start, max }: { start: number; max: number },
  spare: () => number = spareCores,
): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  let failed = false;
  let error: unknown;
  const lanes: Promise<void>[] = [];
  const addLane = () => {
    const session = lanes.length;
    lanes.push(lane(session));
  };
  const lane = async (session: number) => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await run(items[i], session);
      } catch (e) {
        failed = true;
        error ??= e;
        return;
      }
      if (lanes.length < max && next < items.length && spare() >= 2) addLane();
    }
  };
  for (let k = 0; k < Math.min(start, items.length); k++) addLane();
  // (lanes added while waiting are awaited too)
  for (let k = 0; k < lanes.length; k++) await lanes[k];
  if (failed) throw error;
  return out;
}

/** A design's chunks of 100 replications at each sample size, run on R sessions (growingMap); parts in chunk order. */
export function runMcChunks(design: McDesign): Promise<McPart[]> {
  const chunks = design.sampleSizes.flatMap((n) =>
    Array.from({ length: Math.ceil(design.replications / 100) }, (_, c) => ({ n, s: 100 * c })),
  );
  return growingMap(
    chunks,
    ({ n, s }, session) =>
      runMcChunkR(design, n, s, Math.min(design.replications, s + 100), session),
    MC_SESSIONS,
  );
}

/**
 * A Monte Carlo card's design run in R, all its replications, without the bootstrap unless `boot`, at the
 * card's sample sizes or `sizes`.
 */
export async function mcCardRun(id: string, boot = false, sizes?: number[]) {
  const { options } = await open(id, 'Simulation', ['cSEM', 'lavaan']);
  const card = options as McDesign;
  const design: McDesign = {
    ...card,
    bootSamples: boot ? card.bootSamples : 0,
    sampleSizes: sizes ?? card.sampleSizes,
  };
  const parts = await runMcChunks(design);
  const rows = summariseMc(design, parts);
  const row = (estimator: string, key: string, n: number) =>
    rows.find((x) => x.estimator === estimator && x.n === n && x.param.key === key)!;
  // Unimodal: more estimates within ±.05 of their mean than between .10 and .15 from it (a bimodal
  // distribution, as at a null path in Rönkkö & Evermann's model, has its dip at the mean).
  const unimodal = (estimator: string, key: string, n: number) => {
    const ei = design.estimators.findIndex((e) => e.id === estimator);
    const pi = designParameters(design, buildPopulation(design.population)).findIndex(
      (p) => p.key === key,
    );
    const est = parts
      .filter((p) => p.n === n)
      .flatMap((p) => Array.from(p.est[ei][pi]))
      .filter(Number.isFinite);
    const mean = est.reduce((t, v) => t + v, 0) / est.length;
    const share = (lo: number, hi: number) =>
      est.filter((v) => Math.abs(v - mean) >= lo && Math.abs(v - mean) < hi).length / est.length;
    return share(0, 0.05) > share(0.1, 0.15);
  };
  return { card, parts, rows, row, unimodal };
}

export type McCardRun = Awaited<ReturnType<typeof mcCardRun>>;

/** A Rönkkö & Evermann card's design run in R without the bootstrap (point estimates), all 500 replications. */
export async function ronkkoEvermannRun(id: string) {
  const run = await mcCardRun(id);
  same('sample size', run.card.sampleSizes[0], 100);
  same('replications', run.card.replications, 500);
  const path = (estimator: string, n = 100) => run.row(estimator, 'path:A:B', n);
  const reliability = (estimator: string, n = 100) => run.row(estimator, 'reliability:A', n);
  return { ...run, path, reliability };
}

/** Mean absolute error over a card's paths (Sarstedt et al. 2016, Eq. 4), from the replications that converged. */
export function pathMae(run: McCardRun, estimator: string, n: number) {
  const ei = run.card.estimators.findIndex((e) => e.id === estimator);
  const params = designParameters(run.card, buildPopulation(run.card.population));
  const errors = params.flatMap((p, pi) => {
    if (p.kind !== 'path') return [];
    const est = run.parts
      .filter((x) => x.n === n)
      .flatMap((x) => Array.from(x.est[ei][pi]))
      .filter(Number.isFinite);
    return [est.reduce((t, v) => t + Math.abs(v - p.value), 0) / est.length];
  });
  return errors.reduce((t, v) => t + v, 0) / errors.length;
}
