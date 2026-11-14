// The mediation typology in the results (reporting/mediation.ts): the "Type" cells of the indirect
// effects tables, the specific indirect effects table, an explanation of the five types and the
// decision tree, and a reporting sentence per effect with a copy button.

import { useState } from 'react';
import type { BootstrapResult } from '../../engine/types';
import { copyText } from '../../format';
import {
  MEDIATION_LABEL,
  MEDIATION_MEANING,
  ciName,
  mediationSentence,
  pairNotes,
  SEVERAL_MEDIATORS_NOTE,
  type MediationEffect,
  type MediationPair,
  type MediationType,
  type SentenceStyle,
} from '../../reporting/mediation';
import { run } from '../../runner';
import { useStore } from '../../store';
import { IconCopy, IconInfo, IconRepeat } from '../icons';
import { bootCells, bootCols, c, Table, type Cell, type Row } from './Table';

const TYPE_CLASS: Record<MediationType, string> = {
  complementary: 'good',
  competitive: 'good',
  'indirect-only': 'good',
  'direct-only': 'dim',
  'no-effect': 'dim',
};

/** Short type names for table cells (the full names are in the sentences and the explanation). */
const TYPE_SHORT: Record<MediationType, string> = {
  complementary: 'Complementary',
  competitive: 'Competitive',
  'indirect-only': 'Indirect-only',
  'direct-only': 'Direct-only',
  'no-effect': 'No effect',
};

/** The type of one effect as a table cell (noting a direct path that is not in the model). */
export function typeCell(effect: MediationEffect | null | undefined): Cell {
  if (!effect) return c(null);
  const untested = effect.cls.directTested ? '' : ' (no direct path)';
  return c(`${TYPE_SHORT[effect.cls.type]}${untested}`, TYPE_CLASS[effect.cls.type]);
}

/** The total indirect effect of X on Y among the pairs, for the Type column of the totals table. */
export function totalOf(pairs: MediationPair[], from: string, to: string) {
  return pairs.find((p) => p.from === from && p.to === to)?.total ?? null;
}

/** Shown instead of the typology before bootstrapping. */
export function MediationNeedsBoot() {
  return (
    <div className="hint">
      The mediation type of each indirect effect (Zhao et al., 2010) is decided by bootstrap
      confidence intervals, which are not there yet.{' '}
      <button className="btn sm" onClick={() => run('boot')}>
        <IconRepeat size={13} /> Run bootstrapping
      </button>
    </div>
  );
}

/** The specific indirect effects (one per chain of mediators) with their type. */
export function SpecificIndirectTable({
  pairs,
  boot,
}: {
  pairs: MediationPair[];
  boot: BootstrapResult;
}) {
  const rows: Row[] = [];
  for (const pair of pairs) {
    for (const effect of pair.specific) {
      const stat = boot.stats.find((s) => s.key === `specific:${effect.path.join(':')}`);
      rows.push([
        c(effect.path.join(' → ')),
        c(effect.indirect.est),
        ...bootCells(stat),
        typeCell(effect),
      ]);
    }
  }
  if (!rows.length) return null;
  return (
    <Table
      title="Specific indirect effects"
      file="specific-indirect-effects"
      columns={['Effect', 'Estimate', ...bootCols(boot), 'Type']}
      rows={rows}
      note="The product of the path coefficients along one chain of mediators, bootstrapped. The type compares each specific indirect effect with the direct effect of the same pair (Zhao et al., 2010; Nitzl et al., 2016)."
    />
  );
}

/** How the type is decided: the five types, the decision tree and the common questions. */
export function MediationHelp() {
  const types: MediationType[] = [
    'complementary',
    'competitive',
    'indirect-only',
    'direct-only',
    'no-effect',
  ];
  return (
    <div
      className="hint"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 7,
        padding: '10px 12px',
        background: 'var(--surface-2)',
        maxWidth: 760,
      }}
    >
      <p style={{ margin: '0 0 6px' }}>
        <b>Decision tree</b> (Zhao, Lynch &amp; Chen, 2010; for PLS-SEM: Nitzl, Roldán &amp; Cepeda,
        2016; Hair et al., 2021, ch. 7). An effect counts as significant when its bootstrap
        confidence interval excludes zero. The interval type and level are the ones set for
        bootstrapping. Bootstrap p-values are only approximate, so they are not used.
      </p>
      <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>
        <li>Is the indirect effect significant?</li>
        <li>Is the direct effect significant?</li>
        <li>If both are: do they have the same sign?</li>
      </ol>
      <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
        {types.map((t) => (
          <li key={t}>
            <b>{MEDIATION_LABEL[t]}:</b> {MEDIATION_MEANING[t]}
          </li>
        ))}
      </ul>
      <p style={{ margin: '0 0 6px' }}>
        <b>The total effect need not be significant.</b> Unlike Baron and Kenny’s steps, mediation
        does not need a significant total effect: the indirect effect alone decides (Zhao et al.,
        2010; Hayes, 2009).
      </p>
      <p style={{ margin: '0 0 6px' }}>
        <b>Several mediators.</b> Each specific indirect effect is classified against the direct
        effect on its own. “Only 1 of 4 specific indirect effects is significant” is mediation
        through that one mediator, and none through the other three: report each. Specific effects
        with opposite signs can cancel out, so the total indirect effect can be non-significant
        while a specific one is (inconsistent mediation). A serial chain (X → M1 → M2 → Y) is one
        specific effect.
      </p>
      <p style={{ margin: 0 }}>
        <b>No direct path in the model.</b> The direct effect is then fixed at zero, not tested. Add
        the path X → Y to tell indirect-only from partial mediation.
      </p>
    </div>
  );
}

/**
 * The typology's explanation and the reporting sentences of every indirect effect (specific ones, and
 * the total where a pair has several), each with a copy button.
 */
export function MediationReport({
  pairs,
  boot,
  symbol,
}: {
  pairs: MediationPair[];
  boot: Pick<BootstrapResult, 'confidence' | 'interval' | 'tails'>;
  symbol: SentenceStyle['symbol'];
}) {
  const [open, setOpen] = useState(false);
  const toast = useStore((s) => s.toast);
  if (!pairs.length) return null;
  const style: SentenceStyle = { symbol, ci: ciName(boot) };
  const items: { key: string; text: string; tested: boolean }[] = [];
  for (const pair of pairs) {
    const tested = pair.direct !== null;
    for (const effect of pair.specific)
      items.push({
        key: `s:${effect.path.join(':')}`,
        text: mediationSentence(pair, effect, style),
        tested,
      });
    // The total adds information only when there are several chains (or none was bootstrapped).
    if (pair.total && pair.specific.length !== 1)
      items.push({
        key: `t:${pair.from}:${pair.to}`,
        text: mediationSentence(pair, pair.total, style),
        tested,
      });
  }
  // Pairs without a direct path cannot be fully classified: listed after the others, folded.
  const tested = items.filter((x) => x.tested);
  const untested = items.filter((x) => !x.tested);
  const testedNotes = pairs.filter((p) => p.direct).flatMap(pairNotes);
  const untestedNotes = pairs.filter((p) => !p.direct).flatMap(pairNotes);
  const several = pairs.some((p) => p.specific.length > 1);
  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? 'success' : 'error', ok ? 'Sentence copied.' : 'Clipboard access was blocked.');
  };
  return (
    <div>
      <div className="table-tools">
        <h3>Mediation type and reporting</h3>
        <button
          className="btn sm ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title="How the mediation type is decided"
        >
          <IconInfo size={13} /> How the type is decided
        </button>
        <button
          className="btn sm ghost"
          onClick={() => void copy(items.map((x) => x.text).join('\n\n'))}
          title="Copy every sentence"
        >
          <IconCopy size={13} /> Copy all
        </button>
      </div>
      {open && <MediationHelp />}
      <SentenceList items={tested} copy={copy} />
      {untested.length > 0 && (
        <details style={{ margin: '4px 0 8px', maxWidth: 760 }}>
          <summary className="hint" style={{ cursor: 'pointer' }}>
            {untested.length} indirect {untested.length === 1 ? 'effect' : 'effects'} between
            constructs without a direct path (the direct effect is fixed at zero, so the type cannot
            be fully decided)
          </summary>
          <SentenceList items={untested} copy={copy} />
          <Notes notes={untestedNotes} />
        </details>
      )}
      <Notes notes={testedNotes} />
      {several && <Notes notes={[SEVERAL_MEDIATORS_NOTE]} />}
    </div>
  );
}

/** Reporting sentences, each with a copy button. */
function SentenceList({
  items,
  copy,
}: {
  items: { key: string; text: string }[];
  copy: (text: string) => Promise<void>;
}) {
  if (!items.length) return null;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', maxWidth: 760 }}>
      {items.map((x) => (
        <li
          key={x.key}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}
        >
          <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>{x.text}</span>
          <button
            className="btn sm ghost"
            onClick={() => void copy(x.text)}
            aria-label="Copy this sentence"
            title="Copy this sentence"
          >
            <IconCopy size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Notes on the pairs (counts of significant specific effects, inconsistent mediation). */
function Notes({ notes }: { notes: string[] }) {
  return (
    <>
      {notes.map((n) => (
        <p key={n} className="hint" style={{ maxWidth: 760, margin: '0 0 6px' }}>
          {n}
        </p>
      ))}
    </>
  );
}
