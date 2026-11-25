// The partial evidence run (evidenceFiles.mjs): which record file a test file writes, which test file a record came
// from, and the guard that keeps public/validation.json when .validation/ lacks records.
import { describe, expect, it } from 'vitest';
import { evidenceFile as collectorFile } from '../../src/validation/collector';
import { evidenceFile, featureOf, lostChecks, sourcesOf } from './evidenceFiles.mjs';

describe('the partial evidence run', () => {
  it('names record files as the collector does, and maps them back to their test files', () => {
    for (const f of [
      'src/examples/bollen1989.webr.test.ts',
      'src/engine/pls.test.ts',
      'src/analyses/charts.test.tsx',
    ]) {
      expect(evidenceFile(f)).toBe(collectorFile(`/abs/repo/${f}`));
      expect(sourcesOf(evidenceFile(f))).toContain(f);
    }
    expect(featureOf('src/examples/bollen1989.webr.test.ts')).toBe('examples/bollen1989');
  });

  it('lets a check go only when every test file it came from was rerun', () => {
    const check = (id, test) => ({ subject: 'example', id, test });
    const previous = [
      check('a', 'examples/bollen1989: a'),
      check('b', 'examples/bollen1989: b; analyses/cards: b'),
      check('c', 'rengine/pls: c'),
    ];
    const rerun = new Set(['examples/bollen1989']);
    expect(lostChecks(previous, [], rerun)).toEqual(['example b', 'example c']);
    expect(lostChecks(previous, previous, rerun)).toEqual([]);
  });
});
