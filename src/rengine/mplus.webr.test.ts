// Mplus MODEL syntax converted by lavaan (mplus2lavaan.modelSyntax) in webR, then
// built into a diagram. Run with npm run test:webr.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseLavaanSyntax } from '../model/syntax';
import { rCall } from './bridge';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it('converts Mplus BY / ON / WITH syntax, including a pasted input file, into lavaan syntax the importer reads', async () => {
  const mplus =
    'TITLE: test\nDATA: FILE = "x.dat";\nVARIABLE: NAMES = x1-x6 y1 y2;\nMODEL:\n  visual BY x1 x2 x3;\n  textual BY x4 x5 x6;\n  textual ON visual;\n  x1 WITH x4;\nOUTPUT: STANDARDIZED;';
  const { syntax } = await rCall<{ syntax: string }>(
    'ps_mplus_syntax',
    { syntax: mplus },
    'lavaan',
  );
  expect(syntax).toMatch(/visual\s*=~\s*x1\s*\+\s*x2\s*\+\s*x3/);
  expect(syntax).toMatch(/textual\s*~\s*visual/);
  const { model } = parseLavaanSyntax(syntax);
  expect(model.constructs.map((c) => c.name)).toEqual(['visual', 'textual']);
  expect(model.paths).toHaveLength(1);
  expect(model.correlations).toEqual([
    expect.objectContaining({ kind: 'indicator', a: 'x1', b: 'x4' }),
  ]);
  await expect(rCall('ps_mplus_syntax', { syntax: 'x'.repeat(30000) }, 'lavaan')).rejects.toThrow(
    /Invalid Mplus syntax/,
  );
}, 600_000);
