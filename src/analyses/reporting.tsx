// Reporting cards: a draft of the methods section (plain text, LaTeX, BibTeX)
// from the model, the settings and the current results (reporting/methods.ts),
// and the reviewer checklist marked from those results (reporting/checklist.ts).

import { useState } from 'react';
import { IconAlert, IconCheck, IconCopy, IconDownload, IconHelp } from '../components/icons';
import { validateModel } from '../model/validate';
import { checklistBlocked, reviewerChecklist, statusCounts, type CheckItem, type CheckLink, type CheckStatus } from '../reporting/checklist';
import { citeText } from '../reporting/citations';
import { methodsBlocked, methodsText, type LogEntry, type MethodsText, type ReportInput } from '../reporting/methods';
import { fingerprint } from './codec';
import { isObj } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

const GROUP = 'Reporting';
/** The reporting cards themselves are not evidence of anything. */
const REPORTING_TYPES = new Set(['methodstext', 'checklist']);

/** What the reporting texts read: the open project and its current results. */
export function reportInput(ctx: AnalysisCtx, log: LogEntry[] = [], runtime?: ReportInput['runtime']): ReportInput | null {
  if (!ctx.model) return null;
  return { model: ctx.model, settings: ctx.settings, info: ctx.info, pls: ctx.pls, cb: ctx.cb ?? null, miiv: ctx.miiv ?? null, boot: ctx.boot ?? null, process: ctx.process ?? null, invariance: ctx.invariance ?? null, log, runtime };
}

/** The other cards of the analysis log, and the browser R session's versions. */
async function context(): Promise<{ log: LogEntry[]; runtime: ReportInput['runtime'] }> {
  const [{ useAnalyses }, { useR }] = await Promise.all([import('./store'), import('../rengine/status')]);
  const log = useAnalyses.getState().cards.flatMap((c) => (c.kind === 'analysis' && !REPORTING_TYPES.has(c.type) ? [{ type: c.type, run: !!c.run }] : []));
  const v = useR.getState().versions;
  return { log, runtime: { ...(v.R ? { R: v.R } : {}), ...(v.webR ? { webR: v.webR } : {}) } };
}

/** The current results' identity: the model, settings and data (the key), and the bootstrap or invariance test added to them. */
export const resultsFingerprint = (ctx: AnalysisCtx, extra: string[] = []) => (ctx.resultsKey
  ? fingerprint([ctx.resultsKey, ctx.boot ? `${ctx.boot.samples}:${ctx.boot.confidence}:${ctx.boot.seed ?? ''}:${ctx.boot.interval ?? ''}` : 'no-boot', ctx.invariance ? 'inv' : '', ...extra]) : null);

async function copyText(text: string) {
  const { useStore } = await import('../store');
  try { await navigator.clipboard.writeText(text); useStore.getState().toast('success', 'Copied.'); }
  catch { useStore.getState().toast('error', 'The browser did not allow copying; use Download instead.'); }
}

// ---------------------------------------------------------------- methods text

type MethodsTab = 'text' | 'latex' | 'bibtex';
const TABS: [MethodsTab, string, string, string][] = [['text', 'Plain text', 'methods.txt', 'text/plain'], ['latex', 'LaTeX', 'methods.tex', 'application/x-tex'], ['bibtex', 'BibTeX', 'methods.bib', 'application/x-bibtex']];

function MethodsView({ r }: { r: MethodsText }) {
  const [tab, setTab] = useState<MethodsTab>('text');
  // Edits per tab, for this session (copy them into the manuscript).
  const [edits, setEdits] = useState<Partial<Record<MethodsTab, string>>>({});
  const [, label, file, mime] = TABS.find((t) => t[0] === tab)!;
  const value = edits[tab] ?? r[tab];
  return (
    <div className="methods-text">
      <div className="table-tools">
        <div className="segmented" role="tablist" aria-label="Format">
          {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => void copyText(value)} title={`Copy the ${label}`}><IconCopy size={13} /> Copy</button>
        <button className="btn sm ghost" onClick={() => void import('../format').then((f) => f.downloadText(file, value, mime))} title={`Download ${file}`}><IconDownload size={13} /> {file.split('.')[1]}</button>
        {edits[tab] !== undefined && <button className="btn sm ghost" onClick={() => setEdits(({ [tab]: _drop, ...rest }) => rest)} title="Back to the generated text">Reset</button>}
      </div>
      <textarea className="input methods-textarea" aria-label={`Methods text (${label})`} spellCheck={tab === 'text'} rows={tab === 'bibtex' ? 16 : 12} value={value}
        onChange={(e) => setEdits((x) => ({ ...x, [tab]: e.target.value }))} style={{ width: '100%', fontFamily: tab === 'text' ? 'inherit' : 'var(--mono)', fontSize: 12.5, lineHeight: 1.5 }} />
      <div className="hint">A draft from what was configured and calculated: the method, software and package versions that produced the results, estimator, missing data, bootstrap, the model’s structure and the criteria the results are judged by, with their sources ({r.keys.length} works in the BibTeX file; LaTeX uses natbib’s \citep and \citet). It reports no estimates: give those in the results section. Check it against your study and edit it here or after copying (edits here are not saved with the project).</div>
    </div>
  );
}

export const methodsAnalysis: AnalysisType<Record<string, never>, MethodsText> = {
  id: 'methodstext', title: 'Methods text', sub: 'a draft methods paragraph (plain text, LaTeX, BibTeX) of how the model was estimated, with versions and sources', group: GROUP,
  fitsModel: true,
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: () => <p className="hint card-options" style={{ marginTop: 0 }}>Describes the model on the Model tab with its current results: run it again after recalculating or bootstrapping, or after adding assessment cards (PLSpredict, MICOM), which it mentions once they have run.</p>,
  View: ({ result }) => <MethodsView r={result} />,
  blocked: (_o, ctx) => { const input = reportInput(ctx); return input ? methodsBlocked(input) : 'Draw a model first (Model tab).'; },
  fingerprint: (_o, ctx) => resultsFingerprint(ctx, ['methods']),
  run: async (_o, ctx) => { const { log, runtime } = await context(); return methodsText(reportInput(ctx, log, runtime)!); },
  summary: () => 'draft from the current results',
};

// ---------------------------------------------------------------- reviewer checklist

export interface ChecklistResult { method: 'pls' | 'cbsem' | 'process'; items: CheckItem[] }

const STATUS: Record<CheckStatus, { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'good' }, issue: { label: 'Issue', cls: 'bad' }, author: { label: 'Your call', cls: 'warn' }, na: { label: 'Not applicable', cls: 'dim' },
};
const StatusIcon = ({ s }: { s: CheckStatus }) => (s === 'done' ? <IconCheck size={15} /> : s === 'issue' ? <IconAlert size={15} /> : s === 'author' ? <IconHelp size={15} /> : <span aria-hidden="true">–</span>);
const sources = (keys: string[]) => keys.map((k) => citeText(k)).join('; ');

/** Go where the item can be addressed: the Model tab (its results tab named on the button), or a new card. */
async function follow(link: CheckLink) {
  if (link.kind === 'card') { const { addAnalysis } = await import('./store'); addAnalysis(link.type); return; }
  const { useStore } = await import('../store');
  useStore.getState().setWorkspace('model');
}

/** The checklist as plain text (for a response to reviewers). */
export const checklistText = (r: ChecklistResult) => r.items.map((i) => `[${STATUS[i.status].label}] ${i.label}: ${i.evidence} (${sources(i.sources)})`).join('\n');

function ChecklistView({ r }: { r: ChecklistResult }) {
  const n = statusCounts(r.items);
  const sections = [...new Set(r.items.map((i) => i.section))];
  return (
    <div className="checklist">
      <div className="table-tools">
        <span className="hint">{n.done} done · {n.issue} {n.issue === 1 ? 'issue' : 'issues'} · {n.author} for you to answer · {n.na} not applicable</span>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => void copyText(checklistText(r))} title="Copy the checklist as text"><IconCopy size={13} /> Copy</button>
      </div>
      {sections.map((sec) => (
        <section key={sec}>
          <h4 className="checklist-section">{sec}</h4>
          <ul className="checklist-items">
            {r.items.filter((i) => i.section === sec).map((i) => (
              <li key={i.id} className={`checklist-item ${STATUS[i.status].cls}`}>
                <span className="checklist-status" title={STATUS[i.status].label} aria-label={STATUS[i.status].label} role="img"><StatusIcon s={i.status} /></span>
                <div className="checklist-body">
                  <div className="checklist-label">{i.label} <span className="checklist-tag">{STATUS[i.status].label}</span></div>
                  <div className="checklist-evidence">{i.evidence}</div>
                  <div className="checklist-meta"><span className="muted">{sources(i.sources)}</span>
                    {i.link && <button className="btn sm ghost" onClick={() => void follow(i.link!)} title={i.link.kind === 'card' ? 'Add this analysis to the log' : 'Open the Model tab'}>{i.link.kind === 'tab' ? `Model tab: ${i.link.label}` : i.link.label}</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="hint">What reviewers typically ask for, marked from the current results: done (with the evidence), an issue, not applicable, or your call where nothing in the results can show it. Based on {r.method === 'pls' ? 'Hair, Risher, Sarstedt & Ringle (2019), “When to use and how to report the results of PLS-SEM”, and Becker et al. (2023)' : r.method === 'cbsem' ? 'Jackson, Gillaspy & Purc-Stephenson (2009), “Reporting practices in confirmatory factor analysis”, with Hu & Bentler’s (1999) cut-offs' : 'Hayes (2022), Introduction to mediation, moderation, and conditional process analysis'} and the JARS-Quant standards for structural equation modeling (Appelbaum et al., 2018, Table 7). Thresholds are conventions; justify departures rather than hide them.</div>
    </div>
  );
}

export const checklistAnalysis: AnalysisType<Record<string, never>, ChecklistResult> = {
  id: 'checklist', title: 'Reviewer checklist', sub: 'the checks reviewers ask for, marked from the results (Hair et al. 2019; Jackson et al. 2009; JARS-Quant)', group: GROUP,
  fitsModel: true,
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: () => <p className="hint card-options" style={{ marginTop: 0 }}>Checks the model on the Model tab and its current results. Items that other cards answer (PLSpredict, data screening, common method bias, minimum sample size) count once those cards have run: run the checklist again after adding them.</p>,
  View: ({ result }) => <ChecklistView r={result} />,
  blocked: (_o, ctx) => { const input = reportInput(ctx); return input ? checklistBlocked(input) : 'Draw a model first (Model tab).'; },
  fingerprint: (_o, ctx) => resultsFingerprint(ctx, ['checklist']),
  run: async (_o, ctx) => {
    const { log } = await context();
    const input = reportInput(ctx, log)!;
    return { method: ctx.settings.method, items: reviewerChecklist(input, validateModel(input.model, ctx.data, ctx.settings)) };
  },
  summary: () => 'from the current results',
};

export const REPORTING_ANALYSES = [methodsAnalysis, checklistAnalysis];
