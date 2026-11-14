// The hashes that tell a recorded desktop run or a reference script's output from one made with other R code.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rCodeHash, rDefinitions, reachable, rFilesHash, ROOT } from './rSource';

const COMMON = [
  'ps_parse <- function(req_json) jsonlite::fromJSON(req_json)',
  'ps_call <- function(fn, req) do.call(fn, list(req))',
  '',
].join('\n');
const ANALYSIS = [
  '# A header comment.',
  '',
  "#' The entry point.",
  'ps_entry <- function(req_json) {',
  '  x <- ps_helper(ps_parse(req_json))',
  '  do.call("ps_by_name", list(x))',
  '}',
  'ps_helper <- function(x) x + PS_CONSTANT',
  'PS_CONSTANT <- 2',
  'ps_by_name <- function(x) x',
  "#' Not called by the entry point.",
  'ps_other <- function(x) x * 3',
  '',
].join('\n');

function bridge(analysis = ANALYSIS) {
  const dir = mkdtempSync(join(tmpdir(), 'rsource-'));
  writeFileSync(join(dir, 'common.R'), COMMON);
  writeFileSync(join(dir, 'analysis.R'), analysis);
  return dir;
}

describe('rCodeHash: the R code an entry point reaches', () => {
  it('cuts files into top-level definitions, each with the comment lines above it', () => {
    const defs = rDefinitions(bridge());
    expect([...defs.keys()].sort()).toEqual([
      'PS_CONSTANT',
      'ps_by_name',
      'ps_call',
      'ps_entry',
      'ps_helper',
      'ps_other',
      'ps_parse',
    ]);
    expect(defs.get('ps_entry')).toMatch(/^#' The entry point\.\nps_entry <- function/);
    expect(defs.get('ps_other')).toMatch(/^#' Not called/);
    expect(defs.get('ps_by_name')).not.toContain('Not called');
  });

  it('follows names in code and in strings, and ps_call’s path', () => {
    expect(reachable(['ps_entry'], rDefinitions(bridge()))).toEqual([
      'PS_CONSTANT',
      'ps_by_name',
      'ps_call',
      'ps_entry',
      'ps_helper',
      'ps_parse',
    ]);
  });

  it('changes with the code reached, not with code elsewhere', () => {
    const base = rCodeHash(['ps_entry'], bridge());
    expect(rCodeHash(['ps_entry'], bridge())).toBe(base);
    expect(rCodeHash(['ps_entry'], bridge(ANALYSIS.replace('x * 3', 'x * 4')))).toBe(base);
    expect(
      rCodeHash(['ps_entry'], bridge(ANALYSIS.replace('PS_CONSTANT <- 2', 'PS_CONSTANT <- 3'))),
    ).not.toBe(base);
    expect(
      rCodeHash(
        ['ps_entry'],
        bridge(ANALYSIS.replace('ps_by_name <- function(x) x', 'ps_by_name <- function(x) -x')),
      ),
    ).not.toBe(base);
  });

  it('refuses an entry point the bridge does not define', () => {
    expect(() => rCodeHash(['ps_missing'], bridge())).toThrow(/ps_missing is not defined/);
  });

  it('finds the app’s Bayesian entry points', () => {
    expect(reachable(['ps_bsem'])).toContain('ps_bsem_inla');
    expect(reachable(['ps_dsem'])).toContain('ps_dsem_stan');
    expect(rCodeHash(['ps_bsem'])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('rFilesHash', () => {
  it('gives each file’s MD5, as tools::md5sum in R', () => {
    const f = 'src/rengine/R/bayes.R';
    expect(rFilesHash([f])).toEqual({
      [f]: createHash('md5')
        .update(readFileSync(join(ROOT, f)))
        .digest('hex'),
    });
  });
});
