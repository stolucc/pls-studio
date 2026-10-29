// Bootstrap, fit test, IPMA and MIIV-2SLS by the R packages (cSEM, seminr,
// lavaan, MIIVsem). Each builds a request for its R bridge function, parses
// the JSON it returns into the app's result type, and can export the script.

import type { FitTestResult } from '../engine/bootstrap';
import type { CbEstimator } from '../engine/cbsem';
import type { IpmaOptions, IpmaResult } from '../engine/ipma';
import type { MiivResult } from '../engine/miiv';
import type { BootstrapOptions, BootstrapResult, BootstrapStat, Dataset, MissingTreatment, ModelSpec, PlsOptions } from '../engine/types';
import { parallelism, rCall, rCallParallel, rScript, type RPackage, rStrings } from './bridge';
import { bootChunks } from './compute';
import { cbRequest, type LatentInteraction } from './lavaan';
import { plsRequest, type PlsPackage } from './pls';
import type { REngineInfo } from './lavaan';

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
type Raw = Record<string, any>;

// ---------- requests ----------

export type Analysis =
  | { kind: 'plsBoot'; pkg: PlsPackage; options: PlsOptions; boot: BootstrapOptions }
  | { kind: 'cbBoot'; estimator: CbEstimator; missing: MissingTreatment; boot: BootstrapOptions; interaction?: LatentInteraction }
  | { kind: 'fitTest'; options: PlsOptions; boot: BootstrapOptions }
  | { kind: 'ipma'; options: PlsOptions; ipma: IpmaOptions }
  | { kind: 'miiv'; missing: MissingTreatment };

const FN: Record<Analysis['kind'], string> = { plsBoot: 'ps_pls_boot', cbBoot: 'ps_cb_boot', fitTest: 'ps_fittest', ipma: 'ps_ipma', miiv: 'ps_miiv' };

function request(data: Dataset, spec: ModelSpec, a: Analysis): { req: unknown; pkg: RPackage } {
  switch (a.kind) {
    case 'plsBoot': return { req: { ...plsRequest(data, spec, a.options, a.pkg), boot: a.boot }, pkg: a.pkg };
    case 'cbBoot': {
      // LMS / QML latent interactions are modsem models: resampled and refitted with modsem.
      const modsem = (a.interaction ?? 'product') !== 'product' && !!spec.moderations?.length;
      return { req: { ...cbRequest(data, spec, a.missing, a.estimator, a.interaction), boot: a.boot }, pkg: modsem ? 'modsem' : 'lavaan' };
    }
    // The fit test and IPMA are cSEM analyses.
    case 'fitTest': return { req: { ...plsRequest(data, spec, a.options, 'cSEM'), boot: a.boot }, pkg: 'cSEM' };
    case 'ipma': return { req: { ...plsRequest(data, spec, { ...a.options, consistent: false }, 'cSEM'), ipma: { ...a.ipma, min: a.ipma.min ?? null, max: a.ipma.max ?? null } }, pkg: 'cSEM' };
    case 'miiv': return { req: cbRequest(data, spec, a.missing, 'ML'), pkg: 'MIIVsem' };
  }
}

/** The self-contained R script for an analysis (data embedded). */
export function analysisScript(data: Dataset, spec: ModelSpec, a: Analysis): Promise<string> {
  if (a.kind === 'plsBoot' || a.kind === 'cbBoot') {
    return bootParallel(a).then((par) => { const { req, pkg } = par ? chunked(data, spec, a) : request(data, spec, a); return rScript(FN[a.kind], req, pkg); });
  }
  const { req, pkg } = request(data, spec, a);
  return rScript(FN[a.kind], req, pkg);
}

// ---------- parsers ----------

export type BootstrapResultR = BootstrapResult & { engine: REngineInfo; warnings: string[] };

export function parseBoot(raw: Raw, engine: REngineInfo): BootstrapResultR {
  const all = (raw.stats as Raw[]).map((s) => ({
    stat: {
      key: s.key, group: s.group, label: s.label, original: num(s.original), mean: num(s.mean), sd: num(s.sd),
      t: num(s.t), p: num(s.p), ciLow: num(s.ciLow), ciHigh: num(s.ciHigh),
    } as BootstrapStat,
    block: typeof s.block === 'number' ? s.block : 1,
  }));
  const nb = Math.max(1, ...all.map((x) => x.block));
  const byBlock = Array.from({ length: nb }, (_, b) => all.filter((x) => x.block === b + 1).map((x) => x.stat));
  return { samples: raw.samples, failed: raw.failed, confidence: raw.confidence, stats: byBlock[0], ...(nb > 1 ? { byBlock } : {}), engine, warnings: rStrings(raw.warnings) };
}

export function parseFitTest(raw: Raw): FitTestResult & { warnings: string[] } {
  const d = (x: Raw) => ({ srmr: num(x?.srmr), dULS: num(x?.dULS), dG: num(x?.dG) });
  const f = (x: Raw) => ({ saturated: d(x.saturated), estimated: d(x.estimated) });
  return { samples: raw.samples, failed: raw.failed, observed: f(raw.observed), hi95: f(raw.hi95), hi99: f(raw.hi99), warnings: rStrings(raw.warnings) };
}

export function parseIpma(raw: Raw): IpmaResult {
  return {
    target: raw.target, targetPerformance: num(raw.targetPerformance),
    constructs: (raw.constructs as Raw[]).map((k) => ({ name: k.name, importance: num(k.importance), performance: num(k.performance) })),
    indicators: (raw.indicators as Raw[]).map((k) => ({ name: k.name, construct: k.construct, weight: num(k.weight), importance: num(k.importance), performance: num(k.performance) })),
    negativeWeights: rStrings(raw.negativeWeights),
  };
}

export type MiivResultR = MiivResult & { engine: REngineInfo; warnings: string[] };

export function parseMiiv(raw: Raw): MiivResultR {
  const coef = (c: Raw) => ({ lhs: c.lhs, op: c.op, rhs: c.rhs, est: num(c.est), se: num(c.se), z: num(c.z), p: num(c.p), ...(typeof c.std === 'number' ? { std: c.std } : {}) });
  const arr = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]) as string[];
  return {
    n: raw.n,
    equations: (raw.equations as Raw[]).map((e) => ({
      kind: e.kind, dv: e.dv, regressors: arr(e.regressors), instruments: arr(e.instruments), coefficients: (e.coefficients as Raw[]).map(coef),
      sigma2: num(e.sigma2), sargan: typeof e.sargan === 'number' ? e.sargan : null, sarganDf: e.sarganDf ?? 0, sarganP: typeof e.sarganP === 'number' ? e.sarganP : null,
    })),
    estimates: (raw.estimates as Raw[]).map(coef),
    variances: ((raw.variances ?? []) as Raw[]).map((v) => ({ lhs: v.lhs, rhs: v.rhs, latent: !!v.latent, est: num(v.est), std: num(v.std) })),
    fixedStd: Object.fromEntries(Object.entries((raw.fixedStd ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
    r2: Object.fromEntries(Object.entries((raw.r2 ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
    engine: raw.engine, warnings: rStrings(raw.warnings),
  };
}

// ---------- runners ----------

/**
 * Whether a bootstrap runs in chunks on several R sessions. Desktop R:
 * lavaan / modsem bootstraps always (cSEM and seminr use the cores of one R
 * process, with identical results). The browser: cSEM and lavaan with the
 * Parallel setting on (seminr cannot bootstrap there).
 */
export async function bootParallel(a: Analysis): Promise<boolean> {
  const p = await parallelism();
  if (p.where === 'desktop') return a.kind === 'cbBoot' && p.sessions > 1;
  return p.sessions > 1 && (a.kind === 'cbBoot' || (a.kind === 'plsBoot' && a.pkg === 'cSEM'));
}

/** The request with the chunk plan of the parallel option (see bootChunks). */
function chunked(data: Dataset, spec: ModelSpec, a: Extract<Analysis, { kind: 'plsBoot' | 'cbBoot' }>) {
  const { req, pkg } = request(data, spec, a);
  const plan = bootChunks(a.boot.samples, a.boot.seed);
  return { req: { ...(req as Raw), boot: { ...a.boot, chunkR: plan.R, chunkSeed: plan.seed } }, pkg, chunks: plan.R.length };
}

const rows = (v: unknown): unknown[][] => (Array.isArray(v) ? v : []).map((r) => (Array.isArray(r) ? r : [r]));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * Bootstrap by the package. With the parallel option, the chunks are drawn in
 * parallel R sessions and summarised in one last call (equal to the exported
 * script, which draws the chunks in turn).
 */
export async function bootstrapR(data: Dataset, spec: ModelSpec, a: Extract<Analysis, { kind: 'plsBoot' | 'cbBoot' }>, version: () => string,
  onProgress?: (done: number, total: number) => void): Promise<BootstrapResultR> {
  let raw: Raw;
  const { pkg } = request(data, spec, a);
  if (await bootParallel(a)) {
    const { req, chunks } = chunked(data, spec, a);
    const parts = await rCallParallel<Raw>(FN[a.kind], Array.from({ length: chunks }, (_, k) => ({ ...req, boot: { ...req.boot, part: k + 1 } })), pkg,
      (done) => onProgress?.(done, chunks));
    const draws = { names: list(parts[0].names), values: parts.flatMap((p) => rows(p.values)), original: list(parts[0].original) };
    raw = await rCall<Raw>(FN[a.kind], { ...req, boot: { ...req.boot, draws } }, pkg);
    raw.warnings = [...new Set([...parts.flatMap((p) => rStrings(p.warnings)), ...rStrings(raw.warnings)])];
  } else {
    raw = await rCall<Raw>(FN[a.kind], request(data, spec, a).req, pkg);
  }
  return parseBoot(raw, { package: a.kind === 'cbBoot' ? (pkg === 'modsem' ? 'modsem' : 'lavaan') : a.pkg, version: version() });
}

export async function fitTestR(data: Dataset, spec: ModelSpec, options: PlsOptions, boot: BootstrapOptions) {
  const { req, pkg } = request(data, spec, { kind: 'fitTest', options, boot });
  return parseFitTest(await rCall<Raw>('ps_fittest', req, pkg));
}

export async function ipmaR(data: Dataset, spec: ModelSpec, options: PlsOptions, io: IpmaOptions) {
  const { req, pkg } = request(data, spec, { kind: 'ipma', options, ipma: io });
  return parseIpma(await rCall<Raw>('ps_ipma', req, pkg));
}

export async function miivR(data: Dataset, spec: ModelSpec, missing: MissingTreatment) {
  const { req, pkg } = request(data, spec, { kind: 'miiv', missing });
  return parseMiiv(await rCall<Raw>('ps_miiv', req, pkg));
}
