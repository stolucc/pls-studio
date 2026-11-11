// The Validation page's "Analyses" tab: every analysis card, each statistically distinct mode of a card, the Model tab's
// analyses and the built-in engine, with the evidence the manifest names (validation/cards.ts) and what the record
// holds of it. From the manifest, so it shows before the record is regenerated ("evidence pending regeneration").

import { useMemo, useState } from 'react';
import { ANALYSIS_TYPES } from '../../analyses/registry';
import { PACKAGE_EXAMPLES } from '../../examples/packages';
import { splitFeature, type EvidenceClass } from '../../validation/cards';
import { coverage, type CoverageRow } from '../../validation/coverage';
import type { Check, Evidence, EvidenceLevel } from '../../validation/types';
import { evidenceKinds } from '../../validation/useEvidence';
import { LevelChip } from './LevelChip';

const CLASS_TEXT: Record<EvidenceClass, { label: string; hint: string }> = {
  examples: {
    label: 'Graded examples',
    hint: 'Home-screen examples compared with a published or native reference (and often the method’s own tests too).',
  },
  features: {
    label: 'Method tests',
    hint: 'The method’s own tests, each comparing the app with a reference script in desktop R, a published result or known values.',
  },
  unit: {
    label: 'Unit tests',
    hint: 'Unit tests against a reference, not in the validation record.',
  },
  modes: { label: 'By mode', hint: 'The evidence of each mode, listed below it.' },
  none: { label: 'No statistics', hint: 'Computes no statistics of its own.' },
  todo: { label: 'Gap', hint: 'No correctness test yet: the reference planned for one.' },
};
const GROUPS: [CoverageRow['group'], string, string][] = [
  [
    'cards',
    'Analysis cards',
    'Each card on the Analyses tab, and each mode of a card that estimates a different model (a family, link, estimator or engine).',
  ],
  [
    'model',
    'Model tab',
    'The estimation the Model tab runs in R: the estimators, missing-data treatments, approaches and intervals of the settings, and its other analyses.',
  ],
  [
    'builtin',
    'Built-in engine',
    'The TypeScript engine that runs without R (Settings → engine), against the same references.',
  ],
];
const RUNTIME: Record<NonNullable<Check['runtime']>, { label: string; hint: string }> = {
  desktop: {
    label: 'desktop R',
    hint: 'Computed in the helper’s desktop R (the package does not run in the browser), not in webR.',
  },
  fixture: {
    label: 'without R',
    hint: 'Computed without R: the built-in engine, or a desktop run recorded in a fixture and compared again.',
  },
};

function Row({
  r,
  open,
  onToggle,
  onExample,
  onMethod,
}: {
  r: CoverageRow;
  open: boolean;
  onToggle: () => void;
  onExample: (id: string) => void;
  onMethod: (query: string) => void;
}) {
  const kinds = [...new Set(r.checks.flatMap(evidenceKinds))].filter(
    (k) => k !== 'runs',
  ) as EvidenceLevel[];
  const runtimes = [
    ...new Set(
      r.checks.map((c) => c.runtime).filter((x): x is NonNullable<Check['runtime']> => !!x),
    ),
  ];
  const failed = r.checks.some((c) => !c.passed);
  const compared = r.checks.reduce((a, c) => a + c.comparisons.length, 0);
  const awaiting = r.pending.length > 0 && !r.checks.length;
  const exampleTitle = (id: string) => PACKAGE_EXAMPLES.find((x) => x.id === id)?.title ?? id;
  return (
    <div className={`evidence-row${open ? ' open' : ''}${r.mode ? ' mode' : ''}`}>
      <button className="evidence-head" onClick={onToggle} aria-expanded={open}>
        <span
          className={`evidence-status ${r.cls === 'todo' || failed ? 'bad' : r.checks.length ? 'ok' : ''}`}
          aria-hidden
        >
          {r.cls === 'todo' || failed ? '✗' : r.checks.length ? '✓' : r.cls === 'none' ? '–' : '…'}
        </span>
        <span className="evidence-title">
          {r.title} <span className="hint">{r.key}</span>
        </span>
        <span className="evidence-badges">
          <span className={`chip coverage ${r.cls}`} title={CLASS_TEXT[r.cls].hint}>
            {CLASS_TEXT[r.cls].label}
          </span>
          {kinds.map((k) => (
            <LevelChip key={k} level={k} />
          ))}
          {runtimes.map((x) => (
            <span key={x} className="chip coverage runtime" title={RUNTIME[x].hint}>
              {RUNTIME[x].label}
            </span>
          ))}
        </span>
        <span className="hint">
          {r.checks.length
            ? `${r.checks.length} check${r.checks.length === 1 ? '' : 's'}, ${compared} compared${r.pending.length ? `; ${r.pending.length} pending` : ''}`
            : awaiting
              ? 'evidence pending regeneration'
              : ''}
        </span>
      </button>
      {open && (
        <div className="evidence-body">
          {r.entry.none && <p>{r.entry.none}</p>}
          {r.entry.todo && (
            <div className="issue warning">
              No correctness test yet. Planned reference: {r.entry.todo}
            </div>
          )}
          {r.entry.note && <p className="hint">{r.entry.note}</p>}
          <ul className="evidence-sources">
            {(r.entry.examples ?? []).map((id) => {
              const has = r.checks.some((c) => c.subject === 'example' && c.id === id);
              return (
                <li key={id}>
                  Example:{' '}
                  {has ? (
                    <button className="linkish" onClick={() => onExample(id)}>
                      {exampleTitle(id)}
                    </button>
                  ) : (
                    exampleTitle(id)
                  )}{' '}
                  <span className="hint">
                    ({id}
                    {has ? '' : ', evidence pending regeneration'})
                  </span>
                </li>
              );
            })}
            {(r.entry.features ?? []).map((f) => {
              const { file, test } = splitFeature(f);
              const has = r.checks.some(
                (c) => c.subject === 'feature' && c.id.startsWith(`${file}::`),
              );
              return (
                <li key={f}>
                  Tests:{' '}
                  {has ? (
                    <button className="linkish" onClick={() => onMethod(test ?? file)}>
                      {file}
                      {test ? ` (“…${test}…”)` : ''}
                    </button>
                  ) : (
                    <>
                      {file}
                      {test ? ` (“…${test}…”)` : ''}
                    </>
                  )}
                  {!has && <span className="hint"> (evidence pending regeneration)</span>}
                </li>
              );
            })}
            {(r.entry.unit ?? []).map((u) => (
              <li key={u.file}>
                Unit test: {u.file} <span className="hint">({u.reference})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The tab. `onExample` / `onMethod`: show an example's check, or the method checks matching a query. */
export function AnalysesCoverage({
  e,
  onExample,
  onMethod,
}: {
  e: Evidence | null;
  onExample: (id: string) => void;
  onMethod: (query: string) => void;
}) {
  const rows = useMemo(
    () =>
      coverage(
        e,
        ANALYSIS_TYPES.map((t) => t.id),
        (id) => ANALYSIS_TYPES.find((t) => t.id === id)?.title,
      ),
    [e],
  );
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<'all' | 'gaps' | 'pending'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  // A card stays listed when one of its modes matches.
  const match = (r: CoverageRow) =>
    (!q || `${r.title} ${r.key}`.toLowerCase().includes(q)) &&
    (only === 'all' || (only === 'gaps' ? r.cls === 'todo' : r.pending.length > 0));
  const shown = rows.filter(
    (r) =>
      match(r) ||
      (!r.mode && r.group === 'cards' && rows.some((m) => m.mode && m.card === r.card && match(m))),
  );
  const count = (c: EvidenceClass) => rows.filter((r) => r.cls === c).length;
  const cards = rows.filter((r) => r.group === 'cards' && !r.mode).length;
  return (
    <div>
      <p>
        Every analysis and what shows that it computes correctly: {cards} cards with{' '}
        {rows.filter((r) => r.mode).length} modes, {rows.filter((r) => r.group === 'model').length}{' '}
        Model-tab analyses and {rows.filter((r) => r.group === 'builtin').length} parts of the
        built-in engine. {count('examples')} have graded examples, {count('features')} method tests
        {count('unit') ? `, ${count('unit')} unit tests` : ''}; {count('none')} compute no
        statistics{count('todo') ? `; ${count('todo')} have no correctness test yet` : ''}.{' '}
        {rows.filter((r) => r.pending.length).length
          ? `${rows.filter((r) => r.pending.length).length} name tests whose numbers are not in this record yet (written since it was made): evidence pending regeneration.`
          : ''}
      </p>
      <div className="row2" style={{ marginBottom: 8 }}>
        <input
          className="input"
          placeholder="Search analyses"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          aria-label="Search analyses"
        />
        <select
          className="select"
          value={only}
          onChange={(ev) => setOnly(ev.target.value as typeof only)}
          aria-label="Show"
        >
          <option value="all">Every analysis</option>
          <option value="gaps">Gaps (no correctness test)</option>
          <option value="pending">Evidence pending regeneration</option>
        </select>
      </div>
      {!shown.length && <p className="hint">Nothing matches.</p>}
      {GROUPS.map(([g, title, hint]) => {
        const list = shown.filter((r) => r.group === g);
        return list.length ? (
          <section key={g} className="evidence-group">
            <h4>
              {title} <span className="hint">({list.length})</span>
            </h4>
            <p className="hint">{hint}</p>
            {list.map((r) => (
              <Row
                key={r.key}
                r={r}
                open={open === r.key}
                onToggle={() => setOpen(open === r.key ? null : r.key)}
                onExample={onExample}
                onMethod={onMethod}
              />
            ))}
          </section>
        ) : null;
      })}
    </div>
  );
}
