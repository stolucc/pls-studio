// The whole session as one report (HTML or Word): the project's title and the
// date, the model's diagram and results, every card of the analysis log in
// order (headings, notes, tables and charts), the methods text with its
// references, and the software versions. Results are rendered off screen from
// the stored results (so the report does not depend on what is open), every
// tab of a model's results in turn, and read back as blocks (extract.ts).

import { Component, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { analysisType } from '../analyses/registry';
import { ranWith } from '../analyses/ranWith';
import { METHOD_LABEL } from '../analyses/runCard';
import { currentModelResult, currentRunHash } from '../analyses/runs';
import { SnapshotView, type SnapshotResult } from '../analyses/snapshot';
import { cardStatus, currentCtx, unpackCard, useAnalyses } from '../analyses/store';
import type { AnalysisCard, AnalysisType, Card } from '../analyses/types';
import type { Dataset } from '../engine/types';
import { renderFigureSvg } from '../figure/render';
import { figureSource } from '../figure/source';
import type { ModelState } from '../model/project';
import { useR } from '../rengine/status';
import { enginePackages, methodsBlocked, methodsText, type EngineTag } from '../reporting/methods';
import { useStore } from '../store';
import type { Block, FigureBlock, ReportCell, ReportDoc, TableBlock } from './blocks';
import { ReportContext } from './context';
import { extractBlocks } from './extract';
import {
  DEFAULT_REPORT_OPTIONS,
  MAX_DATA_ROWS,
  type ReportFormat,
  type ReportOptions,
} from './options';
import { referenceList } from './references';

/** Renders a view and reads it back as blocks. */
export type ViewRenderer = (node: ReactNode) => Promise<Block[]>;

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return <div className="card-bar bad">This result cannot be shown ({this.state.error}).</div>;
    }
    return this.props.children;
  }
}

/** Render a view off screen (laid out, so charts measure), read its blocks, remove it. */
export const renderOffscreen: ViewRenderer = async (node) => {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:960px;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(
        <ReportContext.Provider value={true}>
          <Boundary>{node}</Boundary>
        </ReportContext.Provider>,
      );
    });
    // Effects that set state (measured sizes) render once more.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return dropEmptySections(extractBlocks(host, 4));
  } finally {
    root.unmount();
    host.remove();
  }
};

/**
 * Results sections (under a level-4 heading: a results tab) with no table,
 * figure or list are left out: on screen they hold instructions ("Drag from a
 * construct's dot…", "No bootstrap results yet"), nothing to report.
 */
export function dropEmptySections(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let section: Block[] | null = null;
  const close = () => {
    if (section && section.slice(1).some((b) => b.kind !== 'paragraph')) out.push(...section);
    section = null;
  };
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === 4) {
      close();
      section = [b];
    } else if (section) {
      section.push(b);
    } else {
      out.push(b);
    }
  }
  close();
  return out;
}

/** A short description of the model for the alt text of its diagram. */
export function diagramAlt(model: ModelState): string {
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  const paths = model.paths.map((p) => `${name.get(p.from) ?? '?'} → ${name.get(p.to) ?? '?'}`);
  const parts = [`Path diagram of the model with ${model.constructs.length} constructs`];
  if (model.constructs.length) {
    parts.push(`(${model.constructs.map((c) => c.name).join(', ')})`);
  }
  let alt = parts.join(' ');
  if (paths.length) alt += `; paths: ${paths.join(', ')}`;
  alt += '.';
  return alt.length > 900 ? `${alt.slice(0, 897)}…` : alt;
}

/** The diagram of the model on the canvas; else the latest logged run's. */
function modelDiagram(cards: Card[]): FigureBlock | null {
  const s = useStore.getState();
  const alt = diagramAlt(s.model);
  const src = figureSource();
  if (src) {
    try {
      const { svg, width, height } = renderFigureSvg(src(), s.settings.figure);
      return { kind: 'figure', svg, width, height, alt };
    } catch {
      // (falls back to a logged diagram)
    }
  }
  const results = useAnalyses.getState().results;
  for (const card of [...cards].reverse()) {
    if (card.kind !== 'analysis' || card.type !== 'run') continue;
    const r = results[card.id] as SnapshotResult | undefined;
    if (!r?.diagram) continue;
    const doc = new DOMParser().parseFromString(r.diagram, 'image/svg+xml').documentElement;
    const width = Number(doc.getAttribute('width')) || 600;
    const height = Number(doc.getAttribute('height')) || 400;
    return { kind: 'figure', svg: r.diagram, width, height, alt };
  }
  return null;
}

const cardTitle = (card: AnalysisCard, t: AnalysisType | undefined) => {
  if (card.title) return card.title;
  if (!t) return card.type;
  return t.cardTitle?.(card.options) ?? t.title;
};

/** The note under a card's title: what it ran with, and when. */
function cardMeta(card: AnalysisCard, t: AnalysisType | undefined): string | null {
  if (!t) return null;
  const what = t.frozen ? 'Snapshot' : t.summary(card.options);
  const when = card.run ? ` · ${new Date(card.run.at).toLocaleString()}` : '';
  return `${what}${when}`;
}

interface LogContext {
  render: ViewRenderer;
  /** The model's results are in the report already (a run of the same version is not repeated). */
  modelShown: boolean;
}

async function cardBlocks(card: Card, o: LogContext): Promise<Block[]> {
  if (card.kind !== 'analysis') {
    if (card.kind === 'heading') {
      return [{ kind: 'heading', level: 2, text: card.text || 'Heading' }];
    }
    return card.text ? [{ kind: 'paragraph', text: card.text, style: 'note' }] : [];
  }
  const t = analysisType(card.type);
  const out: Block[] = [{ kind: 'heading', level: 3, text: cardTitle(card, t) }];
  const meta = cardMeta(card, t);
  if (meta) out.push({ kind: 'paragraph', text: meta, style: 'meta' });
  if (!t) {
    out.push({
      kind: 'paragraph',
      text: 'This kind of analysis is unknown here.',
      style: 'status',
    });
    return out;
  }
  if (!card.run) {
    out.push({ kind: 'paragraph', text: 'Not run.', style: 'status' });
    return out;
  }
  const { results, errors } = useAnalyses.getState();
  const has = card.id in results;
  const status = cardStatus(card, currentCtx(), false, has);
  if (status.state === 'stale' || status.state === 'missing') {
    out.push({ kind: 'paragraph', text: `Out of date: ${status.why}`, style: 'status' });
  }
  const runOfModel =
    card.type === 'run' && (card.options as { hash?: string }).hash === currentRunHash();
  if (runOfModel && o.modelShown) {
    out.push({
      kind: 'paragraph',
      text: 'The same model, settings and data as the model results above.',
      style: 'hint',
    });
    return out;
  }
  if (!has) {
    const why =
      errors[card.id] ??
      'The result is not stored with the project (too large to keep): run the card again.';
    out.push({ kind: 'paragraph', text: why, style: 'status' });
    return out;
  }
  const View = t.View;
  const view = (
    <View result={results[card.id]} options={ranWith(card)} current={status.state === 'current'} />
  );
  out.push(...(await o.render(view)));
  return out;
}

/** Engine tags ({package, version}) in a result and the results inside it. */
export function engineTags(value: unknown, depth = 2): EngineTag[] {
  if (!value || typeof value !== 'object' || depth < 0) return [];
  const v = value as Record<string, unknown>;
  const out: EngineTag[] = [];
  const e = v.engine as Partial<EngineTag> | undefined;
  if (e && typeof e.package === 'string' && typeof e.version === 'string') {
    out.push({
      package: e.package,
      version: e.version,
      ...(typeof e.desktop === 'string' ? { desktop: e.desktop } : {}),
    });
  }
  if (Array.isArray(value)) return out;
  for (const [k, child] of Object.entries(v)) {
    if (k === 'engine') continue;
    if (child && typeof child === 'object' && !ArrayBuffer.isView(child)) {
      out.push(...engineTags(child, depth - 1));
    }
  }
  return out;
}

/** The software table: PLS Studio, R and the R packages that computed the results shown. */
export function softwareTable(tags: EngineTag[], session: Record<string, string>): TableBlock {
  const rows = new Map<string, ReportCell[]>();
  const add = (name: string, version: string, where: string) => {
    const key = `${name}\u0000${version}\u0000${where}`;
    if (rows.has(key)) return;
    rows.set(key, [
      { text: name, numeric: false },
      { text: version || '—', numeric: false },
      { text: where, numeric: false },
    ]);
  };
  add('PLS Studio', '—', 'This report');
  for (const tag of tags) {
    let where = 'R in the browser (webR)';
    if (tag.desktop) {
      const r = /R version ([0-9.]+)/.exec(tag.desktop)?.[1];
      where = r ? `Desktop R ${r}` : 'Desktop R';
    }
    for (const p of enginePackages(tag)) add(p.name, p.version, where);
  }
  if (session.R) add('R', session.R, 'R in the browser (webR)');
  if (session.webR) add('webR', session.webR, 'R in the browser');
  return {
    kind: 'table',
    title: 'Software',
    columns: ['Software', 'Version', 'Computed in'],
    rows: [...rows.values()],
    note: 'Results without an R package were computed by PLS Studio’s built-in engine.',
  };
}

/** The data as a table (up to MAX_DATA_ROWS cases), categories as their labels. */
export function dataTable(data: Dataset, name: string): TableBlock | null {
  if (!data.cols.length) return null;
  const n = data.cols[0].length;
  const shown = Math.min(n, MAX_DATA_ROWS);
  const rows: ReportCell[][] = [];
  for (let i = 0; i < shown; i++) {
    const row: ReportCell[] = [{ text: String(i + 1), numeric: true }];
    data.cols.forEach((col, j) => {
      const v = col[i];
      const labels = data.categories?.[data.names[j]];
      if (Number.isNaN(v)) row.push({ text: '', numeric: true });
      else if (labels) row.push({ text: labels[v - 1] ?? String(v), numeric: false });
      else row.push({ text: String(v), numeric: true });
    });
    rows.push(row);
  }
  const note =
    shown < n
      ? `The first ${shown.toLocaleString()} of ${n.toLocaleString()} cases. Empty cells are missing values.`
      : `${n.toLocaleString()} cases. Empty cells are missing values.`;
  return { kind: 'table', title: name || 'Data', columns: ['Case', ...data.names], rows, note };
}

/** The methods text and its reference list, or why there is none yet. */
async function methodsBlocks(): Promise<Block[]> {
  const { reportInput, methodsContext } = await import('../analyses/reporting');
  const { log, runtime } = await methodsContext();
  const input = reportInput(currentCtx(), log, runtime);
  const out: Block[] = [{ kind: 'heading', level: 2, text: 'Methods' }];
  const blocked = input ? methodsBlocked(input) : 'Draw and calculate a model first.';
  if (!input || blocked) {
    out.push({ kind: 'paragraph', text: blocked ?? '', style: 'hint' });
    return out;
  }
  const m = methodsText(input);
  for (const para of m.text.split(/\n\s*\n/)) {
    if (para.trim()) out.push({ kind: 'paragraph', text: para.trim() });
  }
  const refs = referenceList(m.bibtex);
  if (refs.length) {
    out.push({ kind: 'heading', level: 2, text: 'References' });
    for (const r of refs) out.push({ kind: 'paragraph', text: r, style: 'reference' });
  }
  return out;
}

/** The report's date line. */
const dateLine = (when: Date) =>
  `Report created ${when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}, ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

/** The report of the open project, as blocks. */
export async function buildReport(
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
  render: ViewRenderer = renderOffscreen,
  when = new Date(),
): Promise<ReportDoc> {
  const s = useStore.getState();
  const cards = useAnalyses.getState().cards;
  // Stored results are unpacked first (the log keeps them compressed).
  await Promise.all(
    cards.map((c) => (c.kind === 'analysis' && c.run?.packed ? unpackCard(c.id) : null)),
  );
  const blocks: Block[] = [];
  const model = currentModelResult();
  const tags: EngineTag[] = [];

  if ((options.diagram || options.modelResults) && s.model.constructs.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Model' });
    const m = s.model;
    const extra = m.moderations.length ? `, ${m.moderations.length} moderations` : '';
    blocks.push({
      kind: 'paragraph',
      text: `${METHOD_LABEL[s.settings.method]}: ${m.constructs.length} constructs, ${m.paths.length} paths${extra}.`,
    });
    if (options.diagram) {
      const fig = modelDiagram(cards);
      if (fig) {
        blocks.push({ kind: 'heading', level: 3, text: 'Path diagram' });
        blocks.push(fig);
      }
    }
    if (options.modelResults) {
      blocks.push({ kind: 'heading', level: 3, text: 'Estimates' });
      if (model) {
        tags.push(...engineTags(model));
        blocks.push(...(await render(<SnapshotView r={{ ...model, diagram: null }} />)));
      } else {
        blocks.push({
          kind: 'paragraph',
          text: 'The model has not been calculated with the current settings and data: calculate it on the Model tab to include its results.',
          style: 'status',
        });
      }
    }
  }

  if (options.log && cards.length) {
    if (cards[0].kind !== 'heading') {
      blocks.push({ kind: 'heading', level: 2, text: 'Analyses' });
    }
    const ctx: LogContext = { render, modelShown: options.modelResults && !!model };
    const results = useAnalyses.getState().results;
    for (const card of cards) {
      blocks.push(...(await cardBlocks(card, ctx)));
      if (card.kind === 'analysis') tags.push(...engineTags(results[card.id]));
    }
  }

  if (options.methods) blocks.push(...(await methodsBlocks()));

  if (options.data && s.data) {
    const table = dataTable(s.data, s.dataInfo?.fileName || 'Data');
    if (table) {
      blocks.push({ kind: 'heading', level: 2, text: 'Data' });
      blocks.push(table);
    }
  }

  if (options.software) {
    blocks.push({ kind: 'heading', level: 2, text: 'Software' });
    blocks.push(softwareTable(tags, useR.getState().versions));
  }

  return {
    title: s.projectName || 'Untitled project',
    date: dateLine(when),
    blocks,
  };
}

/** PNG bytes of an SVG at twice its size (for Word). */
async function rasterise(svg: string, width: number, height: number): Promise<Uint8Array> {
  const { pngBlob } = await import('../figure/export');
  const blob = await pngBlob(svg, width, height, 2);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Build the report and download it as HTML or Word. */
export async function exportReport(format: ReportFormat, options: ReportOptions): Promise<void> {
  const s = useStore.getState();
  const doc = await buildReport(options);
  const { downloadBlob, downloadText, safeFileName } = await import('../format');
  const stem = `${safeFileName(s.projectName || 'project')}-report`;
  if (format === 'html') {
    const { reportHtml } = await import('./html');
    downloadText(`${stem}.html`, reportHtml(doc), 'text/html');
    return;
  }
  const { reportDocx } = await import('./docx');
  downloadBlob(`${stem}.docx`, await reportDocx(doc, rasterise));
}
