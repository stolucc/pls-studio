// The Bayesian SEM examples (Mplus 3.18, 5.31, 5.32, 5.33, 11.7) run natively: the card's request goes to the app's
// own R code (src/rengine/R, ps_bsem) in desktop R with blavaan and Stan, as the helper runs it (Rscript --vanilla),
// and the posterior is compared with Mplus's printed output (bsemkit.ts: tolerances and their reasons). Each run is
// recorded in src/engine/__fixtures__/blavaan/mplus.json, which bsem.test.ts checks without R.
//   NATIVE_R_TESTS=1 [PS_R_LIBRARY=<library with lavaan, blavaan, rstan, jsonlite>] npx vitest run src/examples/mplus/bsem.native
// Skipped unless NATIVE_R_TESTS=1 and Rscript loads blavaan (Stan is not in CI; each example takes minutes).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bsemAnalysis } from '../../analyses/bsem';
import { bsemResult, type BsemResult } from '../../rengine/bsem';
import { useCompute } from '../../rengine/compute';
import {
  BSEM_EXAMPLES,
  bsemExample,
  bsemExampleRequest,
  compareWithMplus,
  FIXTURE,
  type Recorded,
} from './bsemkit';

const ROOT = resolve(__dirname, '..', '..', '..');
const lib = process.env.PS_R_LIBRARY ?? join(homedir(), '.pls-studio-helper', 'library');
const env = {
  ...process.env,
  R_LIBS_USER: [lib, process.env.R_LIBS_USER].filter(Boolean).join(':'),
};
const R = (args: string[], timeout = 60_000) =>
  spawnSync('Rscript', ['--vanilla', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout });

function readiness(): string | null {
  if (process.env.NATIVE_R_TESTS !== '1')
    return 'set NATIVE_R_TESTS=1 to run desktop R (blavaan, Stan); each example takes minutes';
  const v = R([
    '-e',
    'cat(as.character(packageVersion("blavaan")), as.character(packageVersion("rstan")))',
  ]);
  if (v.error || v.status !== 0)
    return `Rscript with blavaan and rstan is not available (R_LIBS_USER=${env.R_LIBS_USER}): ${(v.stderr || String(v.error)).slice(-300)}`;
  return null;
}
const why = readiness();
if (why) console.info(`bsem.native.test.ts skipped: ${why}`);

const recorded: Recorded = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Recorded)
  : {};
afterAll(() => {
  if (!why) writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 1)}\n`);
});

/** ps_bsem in desktop R on the request, through ps_call as the helper calls it. */
function runR(req: unknown): BsemResult {
  const dir = mkdtempSync(join(tmpdir(), 'bsem-'));
  writeFileSync(join(dir, 'req.json'), JSON.stringify(req));
  const code = [
    'for (f in sort(list.files("src/rengine/R", "\\\\.R$", full.names = TRUE))) sys.source(f, envir = globalenv())',
    `req <- paste(readLines("${join(dir, 'req.json')}", warn = FALSE), collapse = "\\n")`,
    `writeLines(as.character(ps_call("ps_bsem", req)), "${join(dir, 'out.json')}")`,
  ].join('\n');
  writeFileSync(join(dir, 'run.R'), code);
  const run = R([join(dir, 'run.R')], 3_600_000);
  expect(run.status, run.stderr.slice(-3000)).toBe(0);
  return bsemResult(JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')));
}

describe.skipIf(!!why)('Mplus’s Bayesian SEM examples in desktop R (blavaan)', () => {
  it.each(BSEM_EXAMPLES.map((e) => [e.key]))(
    '%s: within Monte Carlo error of Mplus',
    (key) => {
      const { ctx, options } = bsemExample(key);
      useCompute.setState({ backend: 'helper' } as never);
      expect(bsemAnalysis.blocked(options, ctx), `${key}: the card is ready to run`).toBeNull();
      const r = runR({ ...bsemExampleRequest(key), cores: 3 });
      expect(r.converged, `${key}: R-hat ${r.maxRhat}`).toBe(true);
      const versions = R([
        '-e',
        'cat(R.version.string, as.character(packageVersion("blavaan")), as.character(packageVersion("rstan")), sep = "|")',
      ]).stdout.split('|');
      recorded[key] = {
        result: {
          parameters: r.parameters,
          defined: r.defined,
          loop: r.loop,
          plausible: r.plausible,
          groups: r.groups,
          maxRhat: r.maxRhat,
          minNeff: r.minNeff,
          converged: r.converged,
          priors: r.priors,
          wiggleSd: r.wiggleSd,
          chains: r.chains,
          burnin: r.burnin,
          sample: r.sample,
          seed: r.seed,
        },
        versions: { R: versions[0], blavaan: versions[1], rstan: versions[2] },
      };
      expect(compareWithMplus(key, recorded[key].result)).toBeGreaterThan(0);
    },
    3_600_000,
  );
});
