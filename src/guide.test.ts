// The user guide (public/guide.html) is a static page served next to the app:
// it must work under the app's CSP (no scripts), its contents links must
// resolve, and it must name every analysis the app offers, so adding an
// analysis without documenting it fails here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_TYPES } from './analyses/registry';

const html = readFileSync(join(process.cwd(), 'public', 'guide.html'), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('user guide', () => {
  it('is a plain document: no scripts, no external resources', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bsrc=|@import|url\(/i);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>PLS Studio user guide</title>');
  });

  it('has a contents list whose links all resolve', () => {
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(10);
    for (const a of anchors) expect(html, `missing section #${a}`).toContain(`id="${a}"`);
  });

  it('names every analysis of the Analyses tab, and the File menu entries', () => {
    for (const t of ANALYSIS_TYPES) expect(text, `analysis "${t.title}" is not in the guide`).toContain(t.title);
    for (const item of ['New project', 'Open project', 'Save project', 'Inspect data', 'Create replication package', 'Download R script']) expect(text).toContain(item);
  });

  it('explains verification, password reset and the desktop helper', () => {
    expect(text).toContain('verification email');
    expect(text).toContain('Forgot your password?');
    expect(text).toContain('pls-studio-helper setup');
  });
});
