// The generated notices must cover every runtime dependency (run npm run notices after changing them).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import tp from './third-party.json';

const deps = (p: string) => Object.keys(JSON.parse(readFileSync(join(__dirname, '..', '..', p), 'utf8')).dependencies ?? {}).sort();

it('lists every app and server dependency with a licence', () => {
  expect(tp.npm.map((d) => d.name)).toEqual(deps('package.json'));
  expect(tp.server.map((d) => d.name)).toEqual(deps('server/package.json'));
  for (const d of [...tp.npm, ...tp.server]) expect(d.license, d.name).not.toMatch(/see package|SEE LICENSE/);
});

it('lists every pinned R package', () => {
  const lock = JSON.parse(readFileSync(join(__dirname, '..', '..', 'scripts', 'webr', 'webr-lock.json'), 'utf8'));
  expect(tp.rPackages.map((p) => p.name).sort()).toEqual(Object.keys(lock.packages).sort());
  expect(tp.app.license).toBe('GPL-2.0-or-later');
});
