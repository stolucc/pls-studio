import { useEffect, useMemo, useState } from 'react';
import { PACKAGE_EXAMPLES } from '../../examples/packages';
import { safeUrl } from '../../format';
import type { SelfCheckOutcome } from '../../validation/selfCheck';
import type { Check, Evidence, EvidenceLevel } from '../../validation/types';
import { EVIDENCE_LEVELS } from '../../validation/types';
import {
  evidenceKinds,
  largestDifference,
  LEVEL_TEXT,
  useEvidenceStatus,
} from '../../validation/useEvidence';
import { IconLogo } from '../icons';
import { AnalysesCoverage } from './AnalysesCoverage';
import { LevelChip } from './LevelChip';

type Tab = 'examples' | 'methods' | 'analyses' | 'browser';

/** A reference value: integers as they are, very large or small numbers in exponent form, else 7 digits. */
function num(v: number | string): string {
  if (typeof v !== 'number') return v;
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-4)) return v.toExponential(4);
  return String(Number(v.toPrecision(7)));
}
/** The largest difference from the reference. */
function diff(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return '0';
  if (v < 1e-12) return '< 1e−12';
  return v.toExponential(1);
}

function Sources({ c }: { c: Check }) {
  return (
    <ul className="evidence-sources">
      {c.sources.map((s) => (
        <li key={s.label}>
          {s.level && <LevelChip level={s.level} />}{' '}
          {s.url && safeUrl(s.url) ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.label}
            </a>
          ) : (
            s.label
          )}
          {s.script && <span className="hint"> ({s.script})</span>}
        </li>
      ))}
      {c.runtime === 'desktop' && (
        <li className="hint">
          Computed in the helper’s desktop R (the package does not run in the browser), not in webR.
        </li>
      )}
      {c.runtime === 'fixture' && (
        <li className="hint">
          Computed without R (the built-in engine, or a desktop run recorded in a fixture and
          compared again).
        </li>
      )}
      {c.subject === 'example' && c.runtime !== 'fixture' && (
        <li className="hint">Every run: no unexpected warning or note from R.</li>
      )}
      <li className="hint">Test: {c.test}</li>
    </ul>
  );
}

function Comparisons({ c }: { c: Check }) {
  const [all, setAll] = useState(false);
  const rows = all ? c.comparisons : c.comparisons.slice(0, 60);
  return (
    <>
      <div className="about-table">
        <table className="grid evidence-table">
          <thead>
            <tr>
              <th>Quantity</th>
              <th>This app</th>
              <th>Reference</th>
              <th>|Δ|</th>
              <th>Allowed</th>
              {c.subject === 'example' && <th>Against</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => {
              const d =
                typeof x.value === 'number' && typeof x.reference === 'number'
                  ? Math.abs(x.value - x.reference)
                  : null;
              return (
                <tr key={i}>
                  <td>{x.quantity}</td>
                  <td className="num">{num(x.value)}</td>
                  <td className="num">{num(x.reference)}</td>
                  <td className="num">{diff(d)}</td>
                  <td className="num">{x.tolerance === 0 ? 'exact' : `< ${num(x.tolerance)}`}</td>
                  {c.subject === 'example' && (
                    <td className="hint">{x.source ?? 'the run itself'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {c.comparisons.length > rows.length && (
        <button className="btn sm ghost" onClick={() => setAll(true)}>
          Show all {c.comparisons.length}
        </button>
      )}
    </>
  );
}

function CheckRow({
  c,
  title,
  open,
  onToggle,
}: {
  c: Check;
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  const d = largestDifference(c);
  return (
    <div className={`evidence-row${open ? ' open' : ''}`}>
      <button className="evidence-head" onClick={onToggle} aria-expanded={open}>
        <span
          className={`evidence-status ${c.passed ? 'ok' : 'bad'}`}
          aria-label={c.passed ? 'passed' : 'failed'}
        >
          {c.passed ? '✓' : '✗'}
        </span>
        <span className="evidence-title">{title}</span>
        <span className="evidence-badges">
          {evidenceKinds(c).map((k) => (
            <LevelChip key={k} level={k} />
          ))}
          {c.runtime === 'desktop' && (
            <span className="chip coverage runtime" title="Computed in desktop R, not in webR">
              desktop R
            </span>
          )}
        </span>
        <span className="hint">
          {c.comparisons.length} compared{d !== null ? `, largest |Δ| ${diff(d)}` : ''}
        </span>
      </button>
      {open && (
        <div className="evidence-body">
          <Sources c={c} />
          <Comparisons c={c} />
        </div>
      )}
    </div>
  );
}

function Summary({ e }: { e: Evidence }) {
  const ex = e.checks.filter((c) => c.subject === 'example');
  const count = (l: EvidenceLevel) => ex.filter((c) => evidenceKinds(c).includes(l)).length;
  const failed = e.checks.filter((c) => !c.passed).length;
  const comparisons = e.checks.reduce((a, c) => a + c.comparisons.length, 0);
  return (
    <>
      <p>
        Every example and every method is run by the test suite in the same R the app uses (webR{' '}
        {e.webR}, R {e.R}) and compared with a reference that does not come from this app; the
        packages that run only in desktop R{e.desktop ? ` (recorded on ${e.desktop})` : ''} and the
        built-in engine are marked as such. The numbers below are what the tests compared on{' '}
        {e.generated}: {comparisons.toLocaleString('en')} comparisons in {e.checks.length} checks
        {failed ? `, ${failed} failed` : ', all passed'}.
      </p>
      <table className="grid evidence-levels">
        <thead>
          <tr>
            <th>Badge</th>
            <th className="num">Examples</th>
            <th>What it means</th>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td colSpan={3} className="hint">
              Kinds of evidence, not a ranking: published results show that another author or
              program gets the same numbers (to the decimals printed), native R that the browser
              computes exactly what the package does in desktop R (every estimate, to four to six
              decimals). {ex.filter((c) => evidenceKinds(c).length > 1).length} examples have both.
            </td>
          </tr>
        </tfoot>
        <tbody>
          {EVIDENCE_LEVELS.filter((l) => l !== 'recovery').map((l) => (
            <tr key={l}>
              <td>
                <LevelChip level={l} />
              </td>
              <td className="num">
                {count(l)} of {ex.length}
              </td>
              <td>
                <b>{LEVEL_TEXT[l].long}.</b> {LEVEL_TEXT[l].hint}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** One example's self-check: an error, how many numbers differ (with the first), or identical. */
function outcomeText(o: SelfCheckOutcome): string {
  if (o.error) return `error: ${o.error}`;
  if (!o.differences.length) return 'identical';
  const first = o.differences[0];
  return `${o.differences.length} differ, e.g. ${first.path}: ${first.got} against ${first.want}`;
}

function BrowserCheck({ e }: { e: Evidence }) {
  const [state, setState] = useState<{
    running: boolean;
    done: number;
    total: number;
    id: string;
    out: SelfCheckOutcome[] | null;
    error?: string;
  }>({ running: false, done: 0, total: 0, id: '', out: null });
  const run = async () => {
    setState({ running: true, done: 0, total: 0, id: '', out: null });
    try {
      const { selfCheck } = await import('../../validation/selfCheck');
      const readText = async (path: string) => {
        const r = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.text();
      };
      const out = await selfCheck(e, readText, (done, total, id) =>
        setState((s) => ({ ...s, done, total, id })),
      );
      setState((s) => ({ ...s, running: false, out }));
    } catch (err) {
      setState((s) => ({
        ...s,
        running: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };
  const title = (id: string) => PACKAGE_EXAMPLES.find((x) => x.id === id)?.title ?? id;
  const ok = state.out?.filter((o) => !o.error && !o.differences.length).length ?? 0;
  let runButtonLabel = 'Check this browser';
  if (state.running)
    runButtonLabel = `Running ${state.done + 1} of ${state.total || '…'}: ${title(state.id)}`;
  else if (state.out) runButtonLabel = 'Run again';
  return (
    <div>
      <p>
        Runs ten examples, one for each engine (lavaan, Mplus-style ESEM, seminr, cSEM, IRT, latent
        classes, mixed models, regression, PROCESS, difference-in-differences), here in this
        browser, and compares every number of each result with what the test suite computed: they
        must agree to six significant digits. Nothing leaves your computer. About a minute; the R
        packages are downloaded first if this browser has not loaded them yet.
      </p>
      <button className="btn" onClick={() => void run()} disabled={state.running}>
        {runButtonLabel}
      </button>
      {state.error && <div className="issue error">{state.error}</div>}
      {state.out && (
        <>
          <div
            className={`issue ${ok === state.out.length ? 'good' : 'error'}`}
            style={{ marginTop: 12 }}
          >
            {ok === state.out.length
              ? `All ${ok} examples reproduced: this browser computes what the tests computed.`
              : `${state.out.length - ok} of ${state.out.length} examples differ. Please report this with your browser and system.`}
          </div>
          <table className="grid evidence-table">
            <thead>
              <tr>
                <th>Example</th>
                <th>Numbers compared</th>
                <th>Result</th>
                <th>Seconds</th>
              </tr>
            </thead>
            <tbody>
              {state.out.map((o) => (
                <tr key={o.id}>
                  <td>{title(o.id)}</td>
                  <td className="num">{o.numbers}</td>
                  <td className={o.error || o.differences.length ? 'bad' : 'good'}>
                    {outcomeText(o)}
                  </td>
                  <td className="num">{o.seconds.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * The validation page: what every example and method was checked against, as the test suite recorded it
 * (public/validation.json), and a self-check that re-runs some of it in this browser. `focus`: an example to open
 * (and scroll to); `titles`: example ids to titles; `onBack`: back to where it was opened from.
 */
export function ValidationPage({
  onBack,
  backLabel = 'Back',
  focus,
  titles = {},
}: {
  onBack: () => void;
  backLabel?: string;
  focus?: string;
  titles?: Record<string, string>;
}) {
  const status = useEvidenceStatus();
  const e = status.state === 'ready' ? status.evidence : null;
  const [tab, setTab] = useState<Tab>('examples');
  const [open, setOpen] = useState<string | null>(focus ? `example:${focus}` : null);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<EvidenceLevel | 'all'>('all');
  // From the Analyses tab: the example whose check to scroll to once its tab shows.
  const [jump, setJump] = useState<string | null>(null);
  useEffect(() => {
    if (jump) {
      document.getElementById(`evidence-${jump}`)?.scrollIntoView({ block: 'center' });
      setJump(null);
    }
  }, [jump, tab]);
  const showExample = (id: string) => {
    setTab('examples');
    setQuery('');
    setLevel('all');
    setOpen(`example:${id}`);
    setJump(`example:${id}`);
  };
  const showMethods = (q: string) => {
    setTab('methods');
    setQuery(q);
    setLevel('all');
  };
  const tabs = (has: boolean) => (
    <div className="segmented" role="tablist" aria-label="Validation" style={{ marginBottom: 10 }}>
      {(has
        ? ([
            ['examples', 'Examples'],
            ['methods', 'Methods'],
            ['analyses', 'Analyses'],
            ['browser', 'Check this browser'],
          ] as [Tab, string][])
        : ([['analyses', 'Analyses']] as [Tab, string][])
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id || !has}
          className={tab === id || !has ? 'on' : ''}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !(ev.target instanceof HTMLInputElement)) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  // Opened at an example: scroll to it once the record is there.
  useEffect(() => {
    if (focus && e)
      document.getElementById(`evidence-example:${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, e]);
  const titleOf = (c: Check) =>
    c.subject === 'example'
      ? (titles[c.id] ?? PACKAGE_EXAMPLES.find((x) => x.id === c.id)?.title ?? c.title)
      : c.title;
  const groups = useMemo(() => {
    if (!e) return [];
    const subject = tab === 'methods' ? 'feature' : 'example';
    const q = query.trim().toLowerCase();
    const shown = e.checks.filter(
      (c) =>
        c.subject === subject &&
        (level === 'all' || evidenceKinds(c).includes(level)) &&
        (!q || `${titleOf(c)} ${c.method} ${c.id}`.toLowerCase().includes(q)),
    );
    const by = new Map<string, Check[]>();
    for (const c of shown) by.set(c.method, [...(by.get(c.method) ?? []), c]);
    return [...by].sort(([a], [b]) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, tab, query, level, titles]);
  return (
    <div className="home validation-page">
      <header className="home-head">
        <div className="brand">
          <span className="brand-mark">
            <IconLogo size={17} />
          </span>
          PLS Studio
        </div>
        <button className="btn ghost" onClick={onBack}>
          ← {backLabel}
        </button>
      </header>
      <main className="home-body validation-body" aria-labelledby="validation-title">
        <div className="home-intro">
          <h1 id="validation-title">Validation</h1>
        </div>
        {status.state === 'loading' && <p className="hint">Loading the validation record…</p>}
        {status.state === 'missing' && (
          <>
            <div className="issue warning">
              The validation record is not available in this copy of PLS Studio yet.
            </div>
            <p>
              The record lists what every example and method was checked against: the numbers the
              app computed, the published or native-R reference, and the difference between them. It
              is written by the test suite when a release is prepared, so this copy (a development
              build, or one made without running the tests) does not have it. The checks themselves
              still run with every change of the source; only the record of their numbers is missing
              here.
            </p>
            <p className="hint">
              Developers: <code>npm run validate:evidence</code> runs the tests and writes{' '}
              <code>public/validation.json</code>.
            </p>
            {tabs(false)}
            <AnalysesCoverage e={null} onExample={() => {}} onMethod={() => {}} />
          </>
        )}
        {e && (
          <>
            <Summary e={e} />
            {tabs(true)}
            {tab === 'browser' ? (
              <BrowserCheck e={e} />
            ) : tab === 'analyses' ? (
              <AnalysesCoverage e={e} onExample={showExample} onMethod={showMethods} />
            ) : (
              <>
                <div className="row2" style={{ marginBottom: 8 }}>
                  <input
                    className="input"
                    placeholder={tab === 'methods' ? 'Search methods' : 'Search examples'}
                    value={query}
                    onChange={(ev) => setQuery(ev.target.value)}
                    aria-label="Search"
                  />
                  <select
                    className="select"
                    value={level}
                    onChange={(ev) => setLevel(ev.target.value as EvidenceLevel | 'all')}
                    aria-label="Kind of evidence"
                  >
                    <option value="all">Every kind of evidence</option>
                    {EVIDENCE_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_TEXT[l].long}
                      </option>
                    ))}
                  </select>
                </div>
                {tab === 'methods' && (
                  <p className="hint">
                    The methods’ own tests, beyond the examples: each compares the app with a
                    reference script run in desktop R (scripts/validation/ in the source), a
                    published result, or known values in simulated data.
                  </p>
                )}
                {groups.length === 0 && <p className="hint">Nothing matches.</p>}
                {groups.map(([method, checks]) => (
                  <section key={method} className="evidence-group">
                    <h4>
                      {method} <span className="hint">({checks.length})</span>
                    </h4>
                    {checks.map((c) => {
                      const key = `${c.subject}:${c.id}`;
                      return (
                        <div key={key} id={`evidence-${key}`}>
                          <CheckRow
                            c={c}
                            title={titleOf(c)}
                            open={open === key}
                            onToggle={() => setOpen(open === key ? null : key)}
                          />
                        </div>
                      );
                    })}
                  </section>
                ))}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
