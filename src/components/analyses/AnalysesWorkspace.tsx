import { Component, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { analysisType, ANALYSIS_TYPES } from '../../analyses/registry';
import {
  addAnalysis, currentCtx, addText, cancelCard, cardStatus, duplicateCard, moveCard, moveCardNextTo, nudgeCard, removeCard, runCard, selectCard,
  setOptions, setText, unpackCard, useAnalyses, type CardStatus,
} from '../../analyses/store';
import type { AnalysisCard, AnalysisCtx, AnalysisGroup, Card } from '../../analyses/types';
import { downloadText, safeFileName } from '../../format';
import { useFreshResults, useStore } from '../../store';
import { IconCopy, IconPlay, IconRepeat, IconTrash } from '../icons';
import { confirmDialog } from '../Overlays';
import { openReplication, ReplicationDialog } from './ReplicationDialog';

/** The project as the analyses see it, re-rendering when it changes. */
export function useAnalysisCtx(): AnalysisCtx {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const settings = useStore((s) => s.settings);
  const projectName = useStore((s) => s.projectName);
  const fresh = useFreshResults();
  const pls = settings.method === 'pls' ? fresh?.pls ?? null : null;
  const cb = settings.method === 'cbsem' ? fresh?.cb ?? null : null;
  const model = useStore((s) => s.model);
  return useMemo(() => ({ data, info, settings, pls, cb, projectName, model }), [data, info, settings, pls, cb, projectName, model]);
}

/** How many analysis cards no longer match their options or inputs (for the tab badge). */
export function useStaleCount(): number {
  const cards = useAnalyses((s) => s.cards);
  const results = useAnalyses((s) => s.results);
  const ctx = useAnalysisCtx();
  return cards.filter((c) => c.kind === 'analysis' && cardStatus(c, ctx, false, c.id in results).state === 'stale').length;
}

const readOnlySel = (s: ReturnType<typeof useStore.getState>) => s.cloud?.role === 'viewer';
const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const titleOf = (c: Card) => (c.kind === 'analysis' ? (() => { const t = analysisType(c.type); return t ? t.cardTitle?.(c.options) ?? t.title : c.type; })() : c.text.split('\n')[0].slice(0, 80) || (c.kind === 'heading' ? 'Heading' : 'Note'));

class ResultBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    return this.state.error
      ? <div className="card-bar bad">This result cannot be shown ({this.state.error}). Run the analysis again.</div>
      : this.props.children;
  }
}

/** The options a card's result was computed with (the result is shown with them, even after the options change). */
function ranWith(card: AnalysisCard): unknown {
  const t = analysisType(card.type);
  if (!t || !card.run) return card.options;
  try {
    const ran = t.parseOptions(JSON.parse(card.run.options));
    if (!ran) return card.options;
    // Display-only options follow the card as it is now.
    const now = card.options as Record<string, unknown>;
    return { ...ran, ...Object.fromEntries((t.display ?? []).map((k) => [k, now[k]])) };
  } catch { return card.options; }
}

const PILL: Record<CardStatus['state'], [string, string]> = {
  empty: ['not run', 'muted'], running: ['running…', 'run'], current: ['current', 'ok'], stale: ['stale', 'stale'], missing: ['no result here', 'stale'],
};

function AddMenu({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key); };
  }, [open]);
  // (snapshots are taken from the Model tab, not added here)
  const addable = ANALYSIS_TYPES.filter((t) => !t.frozen);
  const groups = [...new Set(addable.map((t) => t.group))] as AnalysisGroup[];
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const pick = (fn: () => string | null) => { setOpen(false); const id = fn(); if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };
  return (
    <div className="menu" ref={ref}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>+ Add analysis</button>
      {open && (
        <div className="menu-pop" role="menu" aria-label="Add to the analysis log" onKeyDown={onMenuKey}>
          {groups.map((g) => (
            <div key={g}>
              <div className="menu-group">{g}</div>
              {addable.filter((t) => t.group === g).flatMap((t) => (t.entries ?? [{ title: t.title, sub: t.sub, options: undefined }]).map((e) => (
                <button key={`${t.id}:${e.title}`} role="menuitem" className="menu-item" onClick={() => pick(() => addAnalysis(t.id, e.options?.(t.defaults(currentCtx()))))}>
                  <span>{e.title}<br /><span className="sub">{e.sub}</span></span>
                </button>
              )))}
            </div>
          ))}
          <div className="menu-sep" role="separator" />
          <button role="menuitem" className="menu-item" onClick={() => pick(() => addText('heading'))}><span>Heading<br /><span className="sub">a section title for the cards below it</span></span></button>
          <button role="menuitem" className="menu-item" onClick={() => pick(() => addText('note'))}><span>Note<br /><span className="sub">your own text between results</span></span></button>
        </div>
      )}
    </div>
  );
}

async function confirmRemove(card: Card) {
  if (card.kind === 'analysis' && card.run) {
    const ok = await confirmDialog({ title: 'Remove this analysis?', body: `“${titleOf(card)}” and its result will be removed from the log.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
  }
  removeCard(card.id);
}

function CardView({ card, ctx, readOnly, dragging, setDragging }: { card: Card; ctx: AnalysisCtx; readOnly: boolean; dragging: string | null; setDragging: (id: string | null) => void }) {
  const selected = useAnalyses((s) => s.selected === card.id);
  const running = useAnalyses((s) => !!s.running[card.id]);
  const result = useAnalyses((s) => s.results[card.id]);
  const hasResult = useAnalyses((s) => card.id in s.results);
  const error = useAnalyses((s) => s.errors[card.id]);
  const unpacking = useAnalyses((s) => !!s.unpacking[card.id]);
  const progress = useAnalyses((s) => s.progress[card.id]);
  const [over, setOver] = useState(false);
  const packed = card.kind === 'analysis' ? card.run?.packed : undefined;
  useEffect(() => { if (packed && !hasResult) void unpackCard(card.id); }, [card.id, packed, hasResult]);

  const t = card.kind === 'analysis' ? analysisType(card.type) : undefined;
  const status: CardStatus | null = card.kind === 'analysis' ? cardStatus(card, ctx, running, hasResult) : null;
  const drag = {
    draggable: !readOnly,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/x-pls-card', card.id); e.dataTransfer.effectAllowed = 'move'; setDragging(card.id); },
    onDragEnd: () => setDragging(null),
  };
  const drop = {
    onDragOver: (e: DragEvent) => { if (dragging && dragging !== card.id) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/x-pls-card'); if (id) moveCard(id, card.id); },
  };
  const onKey = (e: KeyboardEvent) => {
    if (readOnly || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    nudgeCard(card.id, e.key === 'ArrowUp' ? -1 : 1);
    requestAnimationFrame(() => document.getElementById(card.id)?.querySelector<HTMLElement>('.card-head')?.focus());
  };
  const cls = `log-card ${card.kind}${selected ? ' sel' : ''}${over ? ' over' : ''}${dragging === card.id ? ' dragging' : ''}${status?.state === 'stale' ? ' is-stale' : ''}`;

  if (card.kind !== 'analysis') {
    return (
      <article id={card.id} className={cls} {...drop} onClick={() => selectCard(card.id)}>
        <div className="card-head" tabIndex={0} {...drag} onKeyDown={onKey} aria-label={`${card.kind === 'heading' ? 'Heading' : 'Note'}: ${titleOf(card)} (Alt+↑/↓ to move)`}>
          {!readOnly && <span className="grip" aria-hidden>⋮⋮</span>}
          {card.kind === 'heading' ? <h2>{card.text || <span className="muted">Heading</span>}</h2> : <p className="note-text">{card.text || <span className="muted">Empty note: write it in the pane on the left.</span>}</p>}
          {!readOnly && <span className="card-acts"><button className="btn icon ghost sm" title="Remove" aria-label="Remove" onClick={(e) => { e.stopPropagation(); void confirmRemove(card); }}><IconTrash size={13} /></button></span>}
        </div>
      </article>
    );
  }
  const [label, tone] = t?.frozen && status!.state === 'current' ? ['snapshot', 'run'] : PILL[status!.state];
  return (
    <article id={card.id} className={cls} {...drop} onClick={() => selectCard(card.id)}>
      <div className="card-head" tabIndex={0} {...drag} onKeyDown={onKey} aria-label={`${titleOf(card)} (Alt+↑/↓ to move)`}>
        {!readOnly && <span className="grip" aria-hidden>⋮⋮</span>}
        <h3>{titleOf(card)}</h3>
        <span className={`pill ${tone}`}>{label}</span>
        <span className="muted card-meta">{t?.frozen ? 'snapshot' : t?.summary(card.options as never)}{card.run ? ` · ${when(card.run.at)}` : ''}</span>
        {!readOnly && (
          <span className="card-acts">
            {!t?.frozen && <button className="btn icon ghost sm" title={card.run ? 'Run again' : 'Run'} aria-label={card.run ? 'Run again' : 'Run'} disabled={running} onClick={(e) => { e.stopPropagation(); void runCard(card.id); }}>{card.run ? <IconRepeat size={13} /> : <IconPlay size={13} />}</button>}
            {!t?.frozen && <button className="btn icon ghost sm" title="Duplicate" aria-label="Duplicate" onClick={(e) => { e.stopPropagation(); duplicateCard(card.id); }}><IconCopy size={13} /></button>}
            <button className="btn icon ghost sm" title="Remove" aria-label="Remove" onClick={(e) => { e.stopPropagation(); void confirmRemove(card); }}><IconTrash size={13} /></button>
          </span>
        )}
      </div>
      <div className="card-body">
        {running && <div className="card-bar run">{progress ? <>
            <span className="num">{progress.done}/{progress.total}</span>
            <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><span className="fill" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></span>
          </> : 'Calculating…'} <button className="btn sm" onClick={(e) => { e.stopPropagation(); cancelCard(card.id); }}>Cancel</button></div>}
        {error && <div className="card-bar bad" role="alert">{error}</div>}
        {(status!.state === 'stale' || status!.state === 'missing') && (
          <div className="card-bar stale">{status!.why}
            {!readOnly && <button className="btn sm" onClick={(e) => { e.stopPropagation(); void runCard(card.id); }}><IconRepeat size={12} /> Run again</button>}
          </div>
        )}
        {t && hasResult ? <div className="card-result"><ResultBoundary><t.View result={result} options={ranWith(card)} current={status!.state === 'current'} /></ResultBoundary></div>
          : unpacking ? <div className="muted">Loading the stored result…</div>
          : !card.run && !running && !error && <div className="muted">{readOnly ? 'Not run yet.' : 'Set the options in the pane on the left, then run it.'}</div>}
      </div>
    </article>
  );
}

function OptionsPane({ ctx, readOnly }: { ctx: AnalysisCtx; readOnly: boolean }) {
  const card = useAnalyses((s) => s.cards.find((c) => c.id === s.selected) ?? null);
  const running = useAnalyses((s) => !!(card && s.running[card.id]));
  const project = useStore((s) => s.projectName);
  if (!card) return <div className="muted pane-empty">Select a card to see and change its options.</div>;
  if (card.kind !== 'analysis') {
    return (
      <div className="pane-inner">
        <h2>{card.kind === 'heading' ? 'Heading' : 'Note'}</h2>
        <textarea className="input" aria-label={card.kind === 'heading' ? 'Heading text' : 'Note text'} rows={card.kind === 'heading' ? 2 : 10} maxLength={5000}
          value={card.text} disabled={readOnly} autoFocus={!card.text} onChange={(e) => setText(card.id, e.target.value)} placeholder={card.kind === 'heading' ? 'Section title' : 'Your notes'} />
      </div>
    );
  }
  const t = analysisType(card.type);
  if (!t) return <div className="muted pane-empty">This kind of analysis is not available in this version of PLS Studio.</div>;
  const c = card as AnalysisCard;
  const blocked = t.blocked(c.options, ctx);
  const script = async () => {
    try { downloadText(`${safeFileName(project)}-${t.id}.R`, await t.script!(c.options, ctx), 'text/x-r-source'); } catch (e) {
      const { rMessage } = await import('../../rengine/bridge');
      useStore.getState().toast('error', `${t.title}: ${rMessage(e)}`);
    }
  };
  return (
    <div className="pane-inner">
      <h2>{titleOf(c)}</h2>
      <t.Options options={c.options} set={(o) => setOptions(c.id, o)} ctx={ctx} disabled={readOnly || running} />
      {blocked && !t.frozen && <div className="hint">{blocked}</div>}
      {!readOnly && !t.frozen && (
        <div className="pane-actions">
          <button className="btn primary" disabled={!!blocked || running} onClick={() => void runCard(c.id)}>{running ? 'Calculating…' : c.run ? <><IconRepeat size={13} /> Run again</> : <><IconPlay size={13} /> Run</>}</button>
          {running && <button className="btn" onClick={() => cancelCard(c.id)}>Cancel</button>}
          {t.script && <button className="btn" disabled={!!blocked} onClick={() => void script()}>R script</button>}
        </div>
      )}
    </div>
  );
}

/** The outline: jump to a card, and reorder the log by dragging (or Alt+↑/↓). */
function Outline({ cards, ctx, results, readOnly }: { cards: Card[]; ctx: AnalysisCtx; results: Record<string, unknown>; readOnly: boolean }) {
  const selected = useAnalyses((s) => s.selected);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const jump = (id: string) => { selectCard(id); document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const lowerHalf = (e: DragEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  const end = () => { setDragging(null); setOver(null); };
  return (
    <nav className="card-outline" aria-label="Outline">
      <div className="outline-title">Outline</div>
      {cards.map((c) => {
        const st = c.kind === 'analysis' ? cardStatus(c, ctx, false, c.id in results).state : null;
        const cls = [c.kind === 'heading' ? 'h' : '', c.id === selected ? 'sel' : '', c.id === dragging ? 'dragging' : '',
          over?.id === c.id ? (over.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ');
        return (
          <a key={c.id} href={`#${c.id}`} className={cls} draggable={!readOnly}
            title={readOnly ? undefined : 'Drag to reorder (or Alt+↑/↓)'}
            onClick={(e) => { e.preventDefault(); jump(c.id); }}
            onKeyDown={(e) => {
              if (readOnly || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              nudgeCard(c.id, e.key === 'ArrowUp' ? -1 : 1);
              requestAnimationFrame(() => document.querySelector<HTMLElement>(`.card-outline a[href="#${c.id}"]`)?.focus());
            }}
            onDragStart={(e) => { e.dataTransfer.setData('text/x-pls-card', c.id); e.dataTransfer.effectAllowed = 'move'; setDragging(c.id); }}
            onDragEnd={end}
            onDragOver={(e) => { if (!dragging || dragging === c.id) return; e.preventDefault(); setOver({ id: c.id, after: lowerHalf(e) }); }}
            onDragLeave={() => setOver((o) => (o?.id === c.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/x-pls-card'); if (id) moveCardNextTo(id, c.id, lowerHalf(e)); end(); }}>
            {!readOnly && <span className="grip" aria-hidden>⋮⋮</span>}
            {c.kind !== 'heading' && <span className={`dot ${st ?? 'note'}`} aria-hidden />}{titleOf(c)}
          </a>
        );
      })}
      {!readOnly && cards.length > 1 && <div className="hint outline-hint">Drag the entries to reorder the cards.</div>}
    </nav>
  );
}

/** The Analyses tab: the options of the selected card, the log of cards, and an outline. */
export function AnalysesWorkspace() {
  const cards = useAnalyses((s) => s.cards);
  const results = useAnalyses((s) => s.results);
  const readOnly = useStore(readOnlySel);
  const ctx = useAnalysisCtx();
  const [dragging, setDragging] = useState<string | null>(null);
  const [endOver, setEndOver] = useState(false);
  return (
    <section className="analyses-workspace" role="tabpanel" id="ws-analyses" aria-labelledby="ws-tab-analyses">
      <aside className="card-pane" aria-label="Options of the selected card"><OptionsPane ctx={ctx} readOnly={readOnly} /></aside>
      <main className="card-log" aria-label="Analysis log">
        <div className="log-bar">
          <AddMenu disabled={readOnly} />
          <button className="btn" disabled={!cards.length} onClick={() => void import('../../analyses/report').then((m) => m.exportReport())}
            title="The log as one HTML file: headings, notes and every result as shown here, in APA-like style">Export report</button>
          <button className="btn" onClick={openReplication} title="A zip with the data, an R script per chosen analysis, the project and a README">Replication package</button>
          <span className="hint">{readOnly ? 'View only.' : 'Reorder by dragging in the outline (or a card’s ⋮⋮, or Alt+↑/↓). The log is saved with the project.'}</span>
        </div>
        {cards.length === 0 && (
          <div className="empty-results log-empty">
            No analyses yet. Add one with <b>+ Add analysis</b>: each becomes a card here, kept with the project, which you can rerun when the data or the model change.
          </div>
        )}
        {cards.map((c) => <CardView key={c.id} card={c} ctx={ctx} readOnly={readOnly} dragging={dragging} setDragging={setDragging} />)}
        {dragging && (
          <div className={`log-end${endOver ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setEndOver(true); }} onDragLeave={() => setEndOver(false)}
            onDrop={(e) => { e.preventDefault(); setEndOver(false); const id = e.dataTransfer.getData('text/x-pls-card'); if (id) moveCard(id, null); }}>Move to the end</div>
        )}
      </main>
      <Outline cards={cards} ctx={ctx} results={results} readOnly={readOnly} />
      <ReplicationDialog />
    </section>
  );
}
