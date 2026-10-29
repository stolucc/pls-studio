import { describe, expect, it } from 'vitest';
import { packageDownloadError } from './runtime';

describe('packageDownloadError', () => {
  it('names the packages and the repository, and says what to check', () => {
    const m = packageDownloadError(['MIIVsem'], 'http://localhost:5175/webr/repo/');
    expect(m).toContain('R package MIIVsem from http://localhost:5175/webr/repo/');
    expect(m).toMatch(/server may have stopped/);
    expect(packageDownloadError(['a', 'b'], 'x')).toContain('R packages a, b');
  });
});
