// @vitest-environment happy-dom
// The topic filter sits at the top of the examples and applies to the built-in examples and the package examples alike.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PACKAGE_EXAMPLES } from '../examples/packages';
import { exampleTags } from '../examples/tags';
import { HomeScreen } from './HomeScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the topics once, above every example, and filters both lists by the chosen topic', () => {
  const host = document.createElement('div');
  act(() => { createRoot(host).render(<HomeScreen />); });
  const groups = host.querySelectorAll('[role="radiogroup"][aria-label="Topic"]');
  expect(groups.length).toBe(1);
  const html = host.innerHTML;
  expect(html.indexOf('aria-label="Topic"')).toBeLessThan(html.indexOf('class="example-card"'));
  expect(html.indexOf('aria-label="Topic"')).toBeLessThan(html.indexOf('From R packages'));
  const all = host.querySelectorAll('.example-card').length;
  const button = [...groups[0].querySelectorAll('button')].find((b) => b.textContent === 'Non-recursive')!;
  act(() => { button.click(); });
  const shown = [...host.querySelectorAll('.example-card')];
  expect(shown.length).toBeLessThan(all);
  for (const card of shown) expect(card.querySelector('.example-tags')!.textContent).toContain('Non-recursive');
  expect(shown.length).toBe(PACKAGE_EXAMPLES.filter((e) => exampleTags(e).includes('Non-recursive')).length + 6);  // plus the six built-in non-recursive models (Hayduk 8.6, Duncan-Haller-Portes, Robbins, Bollen's three status models)
});

it('lists the topics in alphabetical order, after All topics', () => {
  const host = document.createElement('div');
  act(() => { createRoot(host).render(<HomeScreen />); });
  const labels = [...host.querySelectorAll('[role="radiogroup"][aria-label="Topic"] button')].map((b) => b.textContent ?? '');
  expect(labels[0]).toBe('All topics');
  const topics = labels.slice(1);
  expect(topics.length).toBeGreaterThan(10);
  expect(topics).toEqual([...topics].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b)));
});

it('filters by author: a row of the authors whose books, manuals and papers the examples reproduce', async () => {
  const { exampleAuthors } = await import('../examples/tags');
  const host = document.createElement('div');
  act(() => { createRoot(host).render(<HomeScreen />); });
  const row = host.querySelector('[role="radiogroup"][aria-label="Author"]')!;
  const names = [...row.querySelectorAll('button')].map((b) => b.textContent ?? '');
  for (const a of ['Bollen', 'Brown', 'Curran', 'Hayduk', 'Kline', 'Muthén', 'Schumacker', 'Lomax', 'Henseler', 'Hair']) expect(names, a).toContain(a);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b)));
  const all = host.querySelectorAll('.example-card').length;
  act(() => { [...row.querySelectorAll('button')].find((b) => b.textContent === 'Bollen')!.click(); });
  const shown = [...host.querySelectorAll('.example-card')];
  for (const card of shown) expect(card.querySelector('[aria-label="Authors"]')?.textContent, card.textContent?.slice(0, 60)).toContain('Bollen');
  // Bollen's package examples, plus the built-ins: political democracy, Bollen & Curran's two latent curve models and the seven from his 1989 book.
  expect(shown.length).toBe(PACKAGE_EXAMPLES.filter((e) => exampleAuthors(e).includes('Bollen')).length + 10);
  // Clicking the author again shows every example.
  act(() => { [...row.querySelectorAll('button')].find((b) => b.textContent === 'Bollen')!.click(); });
  expect(host.querySelectorAll('.example-card').length).toBe(all);
});

it('keeps every filter together at the top: topics, authors and R packages, above every example', () => {
  const host = document.createElement('div');
  act(() => { createRoot(host).render(<HomeScreen />); });
  const rows = [...host.querySelectorAll('[role="radiogroup"]')].map((g) => g.getAttribute('aria-label'));
  expect(rows).toEqual(['Topic', 'Author', 'Package']);
  const html = host.innerHTML;
  expect(html.indexOf('aria-label="Package"')).toBeLessThan(html.indexOf('class="example-card"'));
  const row = host.querySelector('[role="radiogroup"][aria-label="Package"]')!;
  const all = host.querySelectorAll('.example-card').length;
  const lavaan = [...row.querySelectorAll('button')].find((b) => b.textContent === 'lavaan')!;
  act(() => { lavaan.click(); });
  const shown = [...host.querySelectorAll('.example-card')];
  // Only that package's examples: the built-in examples come from no package.
  expect(shown.length).toBe(PACKAGE_EXAMPLES.filter((e) => e.package === 'lavaan').length);
  for (const card of shown) expect(card.querySelector('.chip.accent')!.textContent).toBe('lavaan');
  act(() => { lavaan.click(); });
  expect(host.querySelectorAll('.example-card').length).toBe(all);
});
