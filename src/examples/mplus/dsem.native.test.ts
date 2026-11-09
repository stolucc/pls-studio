// Mplus's Bayesian multilevel and DSEM examples run natively: the DSEM card's request goes to the app's own R code
// (src/rengine/R, ps_dsem) in desktop R with rstan, as the helper runs it (Rscript --vanilla), and the posterior is
// compared with Mplus's printed output (dsemkit.ts: tolerances and their reasons). Each run is recorded in
// src/engine/__fixtures__/dsem/mplus.json, which dsem.test.ts checks without R.
//   NATIVE_R_TESTS=1 [PS_R_LIBRARY=<library with rstan, jsonlite>] [DSEM_ONLY=ex9.30,ex6.26] npx vitest run src/examples/mplus/dsem.native
// Skipped unless NATIVE_R_TESTS=1 and Rscript loads rstan and can compile a Stan program (a C++ toolchain; not in CI).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dsemAnalysis } from '../../analyses/dsem';
import { useCompute } from '../../rengine/compute';
import type { DsemResult } from '../../rengine/dsem';
import { compareWithMplus, DSEM_EXAMPLES, dsemExample, dsemExampleRequest, FIXTURE, readRecorded } from './dsemkit';

const ROOT = resolve(__dirname, '..', '..', '..');
const lib = process.env.PS_R_LIBRARY ?? join(homedir(), '.pls-studio-helper', 'library');
const env = { ...process.env, R_LIBS_USER: [lib, process.env.R_LIBS_USER].filter(Boolean).join(':') };
const R = (args: string[], timeout = 300_000) => spawnSync('Rscript', ['--vanilla', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout });

function readiness(): string | null {
  if (process.env.NATIVE_R_TESTS !== '1') return 'set NATIVE_R_TESTS=1 to run desktop R (rstan, Stan); each example takes minutes';
  const v = R(['-e', 'suppressPackageStartupMessages(library(rstan)); m <- stan_model(model_code = "parameters { real x; } model { x ~ normal(0, 1); }"); cat(as.character(packageVersion("rstan")))']);
  if (v.error || v.status !== 0) return `Rscript with rstan and a C++ toolchain is not available (R_LIBS_USER=${env.R_LIBS_USER}): ${(v.stderr || String(v.error)).slice(-300)}`;
  return null;
}
const why = readiness();
if (why) console.info(`dsem.native.test.ts skipped: ${why}`);

const recorded = readRecorded();
const ran = new Set<string>();
/** Write this run's examples into the fixture as it is now (another run may have recorded others meanwhile). */
function save() {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  const now = readRecorded();
  for (const k of ran) now[k] = recorded[k];
  writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`);
}
afterAll(() => { if (!why && ran.size) save(); });

/** ps_dsem in desktop R on the request, through ps_call as the helper calls it. */
function runR(req: unknown): DsemResult {
  const dir = mkdtempSync(join(tmpdir(), 'dsem-'));
  writeFileSync(join(dir, 'req.json'), JSON.stringify(req, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  const code = [
    'for (f in sort(list.files("src/rengine/R", "\\\\.R$", full.names = TRUE))) sys.source(f, envir = globalenv())',
    `req <- paste(readLines("${join(dir, 'req.json')}", warn = FALSE), collapse = "\\n")`,
    `writeLines(as.character(ps_call("ps_dsem", req)), "${join(dir, 'out.json')}")`,
  ].join('\n');
  writeFileSync(join(dir, 'run.R'), code);
  const run = R([join(dir, 'run.R')], 7_200_000);
  expect(run.status, run.stderr.slice(-3000)).toBe(0);
  return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as DsemResult;
}

/** lme4's sleepstudy as the app reads an R package's data (a factor as its codes). */
function sleepstudy() {
  const v = R(['-e', 'd <- lme4::sleepstudy; d$Subject <- as.integer(d$Subject); write.csv(d, stdout(), row.names = FALSE)']);
  expect(v.status, v.stderr).toBe(0);
  const lines = v.stdout.trim().split('\n');
  const names = lines[0].split(',').map((x) => x.replace(/"/g, ''));
  return { names, cols: names.map((_, j) => Float64Array.from(lines.slice(1).map((l) => Number(l.split(',')[j])))) };
}
/** The Stan program R writes for an example's request (no compiling: R alone). */
function stanProgram(key: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsem-'));
  writeFileSync(join(dir, 'req.json'), JSON.stringify(dsemExampleRequest(key), (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  writeFileSync(join(dir, 'run.R'), [
    'for (f in sort(list.files("src/rengine/R", "\\\\.R$", full.names = TRUE))) sys.source(f, envir = globalenv())',
    `s <- ps_dsem_spec(ps_parse(paste(readLines("${join(dir, 'req.json')}", warn = FALSE), collapse = "\\n")))`,
    'cat(ps_dsem_stan(s))',
  ].join('\n'));
  const run = R([join(dir, 'run.R')]);
  expect(run.status, run.stderr.slice(-3000)).toBe(0);
  return run.stdout;
}
describe.skipIf(process.env.NATIVE_R_TESTS !== '1')('the Stan program: an AR(1) factor with a single indicator is integrated out (Kalman filter)', () => {
  it('9.33: no latent values per row, no sampled values before the series or missing outcomes; the filter restarts at each series', () => {
    const code = stanProgram('ex9.33');
    expect(code).not.toMatch(/vector\[N\] W1;/);
    expect(code).not.toMatch(/pre1|ym2/);
    expect(code).toContain('if (i == first[sid[i]]) { mk = 0; Pk = vf; }');
    expect(code).toContain('real ph = re1[i];');
    expect(code).toContain('target += normal_lpdf(e | 0, sqrt(Sv))');
  });
  it('other models keep their latent values: 6.26 (four indicators), 9.34 (a factor with between parts)', () => {
    for (const k of ['ex6.26', 'ex9.34']) {
      const code = stanProgram(k);
      expect(code).not.toContain('Sv');
      expect(code).toMatch(/vector\[N\] W1;/);
    }
  });
});

const only = process.env.DSEM_ONLY?.split(',');
const CARD_EXAMPLE = 'rstan-dsem-sleepstudy';
describe.skipIf(!!why)('Mplus’s Bayesian multilevel and DSEM examples in desktop R (rstan)', () => {
  it.each([...DSEM_EXAMPLES.map((e) => e.key), CARD_EXAMPLE].filter((k) => !only || only.includes(k)).map((k) => [k]))('%s: within Monte Carlo error of Mplus (the card’s example: recorded for dsem.test.ts)', (key) => {
    const given = key === CARD_EXAMPLE ? sleepstudy() : undefined;
    const { ctx, options } = dsemExample(key, given);
    useCompute.setState({ backend: 'helper' } as never);
    expect(dsemAnalysis.blocked(options, ctx), `${key}: the card is ready to run`).toBeNull();
    // (the chains in parallel, up to 4 cores)
    const r = runR({ ...dsemExampleRequest(key, given), cores: 4 });
    const versions = R(['-e', 'cat(R.version.string, as.character(packageVersion("rstan")), sep = "|")']).stdout.split('|');
    recorded[key] = {
      result: { parameters: r.parameters, maxRhat: r.maxRhat, minNeff: r.minNeff, converged: r.converged, divergent: r.divergent, npar: r.npar, chains: r.chains, warmup: r.warmup, draws: r.draws, seed: r.seed, n: r.n, clusters: r.clusters },
      versions: { R: versions[0], rstan: versions[1] },
    };
    ran.add(key); save();
    expect(r.converged, `${key}: R-hat ${r.maxRhat}`).toBe(true);
    if (key !== CARD_EXAMPLE) expect(compareWithMplus(key, recorded[key].result)).toBeGreaterThan(0);
  }, 7_200_000);
});
