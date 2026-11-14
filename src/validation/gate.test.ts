// The local gate (npm run test:gate, scripts/test-gate.mjs): its desktop-R step names webR test files that exist,
// and keeps the bridge's injection tests and the lavaan, cSEM and seminr core calls.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_R_TESTS } from '../../scripts/test-gate.mjs';
import EVIDENCE_RUNS from './evidenceRuns.json';

const ROOT = join(__dirname, '..', '..');

describe('npm run test:gate', () => {
  it('is a package script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:gate']).toBe('node scripts/test-gate.mjs');
  });

  it('runs webR test files that exist, none slow and none desktop-only', () => {
    expect(GATE_R_TESTS.length).toBeGreaterThan(0);
    for (const f of GATE_R_TESTS) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
      expect(f, f).toMatch(/\.webr\.test\.tsx?$/);
      expect(f, f).not.toMatch(/\.slow\.webr\./);
      expect(EVIDENCE_RUNS.desktop, f).not.toContain(f);
    }
  });

  it('keeps the injection tests and the lavaan, cSEM and seminr core calls', () => {
    for (const f of [
      'src/rengine/injection.webr.test.ts',
      'src/rengine/lavaan.webr.test.ts',
      'src/rengine/pls.webr.test.ts',
      'src/rengine/published.webr.test.ts',
    ])
      expect(GATE_R_TESTS).toContain(f);
  });
});
