import { afterEach, describe, expect, it } from 'vitest';
import { current, endTest, evidenceFile } from './collector';
import { against, definitionHash, example, near, resume, same, UNHASHED_FIELDS } from './record';

describe('evidenceFile', () => {
  it('keeps .webr, so a plain and a webR test file of the same name write different files', () => {
    expect(evidenceFile('/repo/src/rengine/pls.test.ts')).toBe('rengine__pls.json');
    expect(evidenceFile('/repo/src/rengine/pls.webr.test.ts')).toBe('rengine__pls.webr.json');
    expect(evidenceFile('C:\\repo\\src\\analyses\\charts.test.tsx')).toBe('analyses__charts.json');
    expect(evidenceFile('/repo/src/rengine/slow.slow.webr.test.ts')).toBe(
      'rengine__slow.slow.webr.json',
    );
  });
});

describe('definitionHash', () => {
  const def = { id: 'x', settings: { method: 'cbsem', b: 1 }, paths: [['a', 'b']] };

  it('ignores key order', () => {
    expect(
      definitionHash({ paths: [['a', 'b']], settings: { b: 1, method: 'cbsem' }, id: 'x' }),
    ).toBe(definitionHash(def));
  });

  it('changes with what is estimated', () => {
    expect(definitionHash({ ...def, settings: { method: 'pls', b: 1 } })).not.toBe(
      definitionHash(def),
    );
  });

  it('leaves out what an example shows and the messages it is expected to raise, so rewording them keeps its evidence current', () => {
    expect(UNHASHED_FIELDS).toEqual(['shows', 'expectedMessages']);
    expect(
      definitionHash({
        ...def,
        shows: 'What it shows.',
        expectedMessages: [{ pattern: 'p', why: 'w' }],
      }),
    ).toBe(definitionHash(def));
    // (only at the top level: a nested field of the same name is part of the definition)
    expect(definitionHash({ ...def, settings: { ...def.settings, shows: 1 } })).not.toBe(
      definitionHash(def),
    );
  });

  it('hashes non-objects as before', () => {
    expect(definitionHash(null)).toBe(definitionHash(undefined));
    expect(definitionHash([1, 2])).not.toBe(definitionHash([2, 1]));
  });
});

describe('the level an example’s comparisons give it', () => {
  const start = (id: string) => example(id, { title: id, method: 'CB-SEM', packages: ['lavaan'] });
  afterEach(() => {
    current.example = null;
    current.source = null;
  });

  it('published or native only with an estimated quantity: counts alone leave it at “runs”', () => {
    const c = start('test-counts');
    against({ label: 'a book (counts)', level: 'published' });
    same('df', 24, 24);
    same('parameters', 21, 21);
    expect(c.level).toBe('runs');
    near('χ²', 85.306, 85.306, 0.001);
    expect(c.level).toBe('published');
    expect(c.comparisons).toHaveLength(3);
  });

  it('same R: the package’s own function in the same R session, below native', () => {
    const c = start('test-same-r');
    against({ label: 'the package, called in the same R', level: 'same-r' });
    near('log-likelihood', -100.5, -100.5, 1e-6);
    expect(c.level).toBe('same-r');
    against({ label: 'desktop R', level: 'native' });
    near('log-likelihood', -100.5, -100.5, 1e-6);
    expect(c.level).toBe('native');
  });

  it('records a bound that is Monte Carlo error as such', () => {
    const c = start('test-monte-carlo');
    against({ label: 'Mplus (its own imputations)', level: 'published' });
    near('pooled estimate', 0.444, 0.34, 0.336, { monteCarlo: true });
    near('complete data', 1, 1, 0.001);
    expect(c.comparisons.map((x) => x.monteCarlo)).toEqual([true, undefined]);
  });

  it('resume: back to an earlier example, its comparisons recorded there and not under the last one started', () => {
    const first = start('test-resume-first');
    const second = start('test-resume-second');
    resume('test-resume-first');
    against({ label: 'a paper', level: 'published' });
    near('GoF', 0.37, 0.37, 0.01);
    expect(first.comparisons).toHaveLength(1);
    expect(first.level).toBe('published');
    expect(second.comparisons).toHaveLength(0);
    expect(() => resume('test-resume-never-started')).toThrow(/before example/);
  });
});

describe('the end of a test', () => {
  const start = (id: string) => example(id, { title: id, method: 'PLS', packages: ['cSEM'] });
  afterEach(() => {
    current.abandoned = false;
    current.touched.clear();
  });

  it('a passed test leaves its examples passed and starts the next test afresh', () => {
    const c = start('end-passed');
    endTest(false, false, null);
    expect(c.passed).toBe(true);
    expect(current.example).toBeNull();
    expect(current.touched.size).toBe(0);
  });

  it('a failed test fails every example it fed, not only the last, and its feature check', () => {
    const a = start('end-failed-a');
    const b = start('end-failed-b');
    const feature = { ...a, id: 'feature', passed: true };
    endTest(true, false, feature);
    expect([a.passed, b.passed, feature.passed]).toEqual([false, false, false]);
  });

  it('after a timeout no later check of the file passes, since the abandoned test may still record into it', () => {
    const timedOut = start('end-timeout');
    endTest(true, true, null);
    expect(timedOut.passed).toBe(false);
    const later = start('end-after-timeout');
    endTest(false, false, null);
    expect(later.passed).toBe(false);
  });
});
