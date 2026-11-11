// The order in which vitest starts the webR test files: the slowest first, by scripts/webr/test-timings.json (seconds per
// file, from a recorded run: node scripts/webr/timings.mjs <vitest JSON report>), so the long files do not start last and
// hold up the end of the run. Files without a recorded time (new ones) go first; vitest's own order (its cache of the last
// run's durations, then file sizes) settles the rest.

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const ROOT = join(__dirname, '..', '..');

function recorded(): Record<string, number> {
  try {
    return (
      JSON.parse(readFileSync(join(ROOT, 'scripts', 'webr', 'test-timings.json'), 'utf8')).files ??
      {}
    );
  } catch {
    return {};
  }
}

export default class WebrSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const base = await super.sort(files);
    const times = recorded();
    const t = (f: TestSpecification) => times[relative(ROOT, f.moduleId).split('\\').join('/')];
    const rank = new Map(base.map((f, i) => [f, i]));
    return [...base].sort((a, b) => {
      const ta = t(a),
        tb = t(b);
      // Files never timed first, then the slowest first; otherwise the base order.
      if (ta === undefined && tb !== undefined) return -1;
      if (tb === undefined && ta !== undefined) return 1;
      if (ta === undefined || tb === undefined) return rank.get(a)! - rank.get(b)!;
      return tb - ta;
    });
  }
}
