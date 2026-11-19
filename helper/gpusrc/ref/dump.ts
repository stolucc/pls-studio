// Reference values from the native engine for validating the GPU port: the
// prepared columns, the compiled model, the estimate and a bootstrap (every draw).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { parseCsv } from '../../../src/engine/dataset';
import { preparePls } from '../../../src/engine/pls';
import { mergeBootstrap, runRange } from '../../../src/engine/bootstrap';
import { DEFAULT_OPTIONS, type ModelSpec, type PlsOptions } from '../../../src/engine/types';

const root = join(__dirname, '..', '..', '..');
const data = parseCsv(readFileSync(join(root, 'src/engine/__fixtures__/mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);

function mobiModel(qualityMode: 'A' | 'B'): ModelSpec {
  return {
    constructs: [
      { name: 'Image', mode: 'A', indicators: items('IMAG', 5) },
      { name: 'Expectation', mode: 'A', indicators: items('CUEX', 3) },
      { name: 'Quality', mode: qualityMode, indicators: items('PERQ', 7) },
      { name: 'Value', mode: 'A', indicators: items('PERV', 2) },
      { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) },
      { name: 'Complaints', mode: 'A', indicators: ['CUSCO'] },
      { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) },
    ],
    paths: [
      ['Image', 'Expectation'],
      ['Image', 'Satisfaction'],
      ['Image', 'Loyalty'],
      ['Expectation', 'Quality'],
      ['Expectation', 'Value'],
      ['Expectation', 'Satisfaction'],
      ['Quality', 'Value'],
      ['Quality', 'Satisfaction'],
      ['Value', 'Satisfaction'],
      ['Satisfaction', 'Complaints'],
      ['Satisfaction', 'Loyalty'],
      ['Complaints', 'Loyalty'],
    ].map(([from, to]) => ({ from, to })),
  };
}

const B = Number(process.env.B ?? 500);
const cases: {
  name: string;
  spec: ModelSpec;
  options: Partial<PlsOptions>;
  keep?: boolean;
  jackknife?: boolean;
  inner?: number;
  samples?: number;
}[] = [
  { name: 'modeA_path', spec: mobiModel('A'), options: {} },
  { name: 'modeB_path', spec: mobiModel('B'), options: {} },
  { name: 'modeA_factor', spec: mobiModel('A'), options: { scheme: 'factor' } },
  { name: 'modeA_centroid', spec: mobiModel('A'), options: { scheme: 'centroid' } },
  { name: 'plsc_path', spec: mobiModel('A'), options: { consistent: true } },
  { name: 'plsc_keep', spec: mobiModel('A'), options: { consistent: true }, keep: true },
  { name: 'modeA_bca', spec: mobiModel('A'), options: {}, jackknife: true, samples: 200 },
  { name: 'modeA_stud', spec: mobiModel('A'), options: {}, inner: 20, samples: 100 },
];

const out = join(__dirname, 'out');
mkdirSync(out, { recursive: true });
for (const c of cases) {
  const opts = { ...DEFAULT_OPTIONS, ...c.options, ...(c.keep ? { absRhoA: true } : {}) };
  const prep = preparePls(data, c.spec, opts);
  const est = prep.estimate(prep.cols);
  const t0 = performance.now();
  const part = runRange({
    job: 'pls',
    data,
    spec: c.spec,
    options: c.options,
    seed: 1,
    start: 0,
    end: c.samples ?? B,
    keepInadmissible: c.keep,
    ...(c.jackknife ? { jackknife: true } : {}),
    ...(c.inner ? { innerSamples: c.inner } : {}),
  });
  const ms = performance.now() - t0;
  const merged = mergeBootstrap([part], 0.95);
  const json = {
    name: c.name,
    options: opts,
    keepInadmissible: !!c.keep,
    model: prep.m,
    cols: prep.cols.map((x) => Array.from(x)),
    estimate: {
      w: Array.from(est.core.w),
      iterations: est.core.iterations,
      loadings: est.st.loadings,
      pathCoef: est.st.pathCoef,
      C: est.st.C,
      rSquared: est.st.rSquared,
      rhoA: est.st.rhoA,
      totalEffects: est.st.totalEffects,
    },
    boot: {
      seed: 1,
      samples: c.samples ?? B,
      ms,
      jackknife: !!c.jackknife,
      innerSamples: c.inner ?? 0,
      params: part.params.map((p) => p.key),
      originals: part.originals,
      draws: part.draws.map((d) => Array.from(d)),
      ...(part.jack ? { jack: part.jack.map((d) => Array.from(d)) } : {}),
      ...(part.studentized ? { studentized: part.studentized.map((d) => Array.from(d)) } : {}),
      groups: part.params.map((p) => p.group),
      labels: part.params.map((p) => p.label),
      stats: merged.stats.map((s) => ({ key: s.key, mean: s.mean, sd: s.sd, ciLow: s.ciLow, ciHigh: s.ciHigh })),
      failed: merged.failed,
    },
  };
  writeFileSync(join(out, `${c.name}.json`), JSON.stringify(json));
  console.log(`${c.name}: n=${prep.cols[0].length} B=${c.samples ?? B} failed=${merged.failed} ${ms.toFixed(0)} ms`);
}
