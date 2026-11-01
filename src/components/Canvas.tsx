import type React from 'react';
import {
  Background, BackgroundVariant, ControlButton, Controls, MiniMap, ReactFlow, useReactFlow,
  type Connection, type ConnectionLineComponentProps, type EdgeChange, type FinalConnectionState, type NodeChange, type OnDelete,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { CONSTANT_R, constructGeometry, distanceToSegment, interceptSegment, meanSegment, moderatorSegment, pathOffset, pathSegment, quadraticLoop } from '../geometry';
import { figureCssVars } from '../figure/style';
import type { FigureInput, FigureLabel } from '../figure/render';
import { canvasLabelSize, placeFigureLabels } from '../figure/labels';
import { FigurePanel } from './FigurePanel';
import { setFigureSource } from '../figure/source';
import { numberDialog, textDialog } from './Overlays';
import { nameError } from '../model/expr';
import { ProcessGallery } from './ProcessGallery';
import { ProcessBar } from './ProcessBar';
import { ModelVersionBadge } from './ModelVersionBadge';
import { fitPadding, overlayBottom } from '../canvasFit';
import { ContextMenu } from './ContextMenu';
import { menuFor, type MenuAction, type MenuTarget } from './canvasMenu';
import { correlationEndError, correlationPairError, endogenousIds, impliedIntercepts, impliedMainEffects, newId, validateModel, type Correlation } from '../model/project';
import { endAt } from './correlationEnds';
import type { ExampleId } from '../io';
import { run } from '../runner';
import { resultsKey, useFreshResults, useStore, type Selection, type Tool } from '../store';
import { ConstructNode, type ConstructFlowNode } from './ConstructNode';
import { ConstantNode, type ConstantFlowNode } from './ConstantNode';
import { InterceptEdge, type InterceptFlowEdge } from './InterceptEdge';
import { MeanEdge, type MeanFlowEdge } from './MeanEdge';
import { indicatorLabels } from '../diagramLabels';
import { readDraggedVars, VARS_MIME } from './dnd';
import { IconArrow, IconCorrelate, IconDownload, IconEllipse, IconErrorTerm, IconFitView, IconLayout, IconPlay, IconPointer, IconSparkle, IconTriangle, IconUpload } from './icons';
import { CovarianceLayer, covarianceLayout, type CorrelationLabel, type CorrelationPick } from './CovarianceLayer';
import { currentSession } from '../cloud/collab';
import { PresenceLayer } from './cloud/Presence';
import { HigherOrderLayer, type HoLabel } from './HigherOrderLayer';
import { ModeratorLayer, type ModerationLabel } from './ModeratorLayer';
import { PathEdge, type PathFlowEdge } from './PathEdge';

const nodeTypes = { construct: ConstructNode, constant: ConstantNode };
const edgeTypes = { path: PathEdge, mean: MeanEdge, intercept: InterceptEdge };
type FlowNode = ConstructFlowNode | ConstantFlowNode;
type FlowEdge = PathFlowEdge | MeanFlowEdge | InterceptFlowEdge;

function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  return <path d={`M ${fromX} ${fromY} L ${toX} ${toY}`} stroke="var(--accent)" strokeWidth={1.8} strokeDasharray="5 4" fill="none" markerEnd="url(#arrow-path-sel)" />;
}

function Markers() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <marker id="arrow-ind" viewBox="0 0 10 10" refX={9.5} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="var(--indicator-arrow, #9aa3b5)" />
        </marker>
        <marker id="arrow-path" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--path)" />
        </marker>
        <marker id="arrow-path-sel" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
        <marker id="arrow-mod" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="var(--mod, #8b5cf6)" />
        </marker>
        <marker id="arrow-mod-sel" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="var(--accent)" />
        </marker>
      </defs>
    </svg>
  );
}

const TOOLS: { id: Tool; label: string; key: string; icon: typeof IconPointer }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: IconPointer },
  { id: 'construct', label: 'Construct', key: 'C', icon: IconEllipse },
  { id: 'connect', label: 'Path', key: 'P', icon: IconArrow },
  { id: 'correlate', label: 'Correlation', key: 'R', icon: IconCorrelate },
];

interface EmptyProps { onImport: () => void; onSample: (which: ExampleId) => void }

export function Canvas({ onImport, onSample }: EmptyProps) {
  const model = useStore((s) => s.model);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const data = useStore((s) => s.data);
  const showResults = useStore((s) => s.showResultsOnDiagram);
  const hasStaleResults = useStore((s) => s.results !== null && s.results.key !== resultsKey(s));
  const results = useFreshResults();
  const st = useStore.getState;
  const rf = useReactFlow();
  const fitRequest = useStore((s) => s.fitRequest);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Fit the diagram into view below the floating toolbars. fitView frames nodes only;
  // CB-SEM's correlation arcs and error terms reach beyond them (more padding).
  const fitOptions = useCallback(() => ({
    padding: fitPadding(st().settings.method === 'cbsem' ? 0.35 : 0.2, overlayBottom(wrapRef.current)), maxZoom: 1.1,
  }), [st]);
  useEffect(() => {
    if (fitRequest === 0) return;
    const t = setTimeout(() => void rf.fitView({ ...fitOptions(), duration: 250 }), 40);
    return () => clearTimeout(t);
  }, [fitRequest, rf, fitOptions]);

  const settings = useStore((s) => s.settings);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  // The canvas stays mounted behind the Data tab; keys must not delete its selection there.
  const workspace = useStore((s) => s.workspace);
  const showErrors = useStore((s) => s.showErrorTerms);
  const showImplied = useStore((s) => s.showImpliedEffects);
  const scale = useStore((s) => s.estimateScale);
  const unstd = scale === 'unstd';
  const method = settings.method;
  // Moderators' main effects on the outcome that the diagram does not draw (estimated anyway).
  // (CPA too: Hayes's statistical diagrams draw them; PROCESS estimates them.)
  const implied = useMemo(() => impliedMainEffects(model), [model]);
  const tools = method === 'cbsem' ? TOOLS : TOOLS.filter((t) => t.id !== 'correlate');

  // Correlation tool: the first end picked, waiting for the second.
  const [picked, setPicked] = useState<CorrelationPick | null>(null);
  // "Correlate with…" from a context menu switches to the tool with its first end picked.
  const pendingPick = useRef<CorrelationPick | null>(null);
  useEffect(() => { setPicked(pendingPick.current); pendingPick.current = null; }, [tool]);
  useEffect(() => { if (method !== 'cbsem' && tool === 'correlate') st().setTool('select'); }, [method, tool, st]);
  /** Is this end allowed at all? Explains why not. */
  const endOk = useCallback((p: CorrelationPick) => {
    const endError = correlationEndError(st().model, p);
    if (!endError) return true;
    st().toast('info', endError);
    if (!st().showErrorTerms) st().setShowErrorTerms(true);
    return false;
  }, [st]);
  /** Correlate two ends (a correlation is estimated only when drawn). */
  const link = useCallback((a: CorrelationPick, b: CorrelationPick) => {
    const pairError = correlationPairError(st().model, a, b);
    if (pairError) { st().toast('error', pairError); return; }
    st().addCorrelation(a.kind, a.id, b.id);
  }, [st]);
  const pick = useCallback((p: CorrelationPick) => {
    if (!endOk(p)) return;
    if (!picked) { setPicked(p); return; }
    if (picked.kind === p.kind && picked.id === p.id) { setPicked(null); return; }
    link(picked, p);
    setPicked(null);
  }, [picked, endOk, link]);

  // Drawing a correlation by dragging from one end (construct, indicator error, disturbance) to another.
  const [rubber, setRubber] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const onCorrelateDown = (e: React.PointerEvent) => {
    if (tool !== 'correlate' || readOnly || e.button !== 0) return;
    const start = endAt(e.target as Element);
    if (!start) return;
    // Keep React Flow from panning the canvas along with the pointer (clicks still reach the node).
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      setRubber({ x1: x0 - box.left, y1: y0 - box.top, x2: ev.clientX - box.left, y2: ev.clientY - box.top });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      setRubber(null);
      if (!moved) return; // a click: handled by the click-to-pick flow
      const end = endAt(document.elementFromPoint(ev.clientX, ev.clientY));
      if (!end || (end.kind === start.kind && end.id === start.id && end.via === start.via)) return;
      if (endOk(start) && endOk(end)) link(start, end);
      setPicked(null);
    };
    // Capture phase: React Flow stops pointer events from bubbling up from nodes.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  };
  const errorIds = useMemo(
    () => new Set(validateModel(model, data, settings).filter((i) => i.level === 'error' && i.constructId).map((i) => i.constructId!)),
    [model, data, settings],
  );

  /** Per-construct and per-indicator numbers to draw, for whichever method produced results. */
  const display = useMemo(() => {
    if (!showResults || !results) return null;
    if (method === 'cbsem' && settings.estimator === '2SLS' && results.miiv) {
      // MIIV-2SLS: unstandardised coefficients; standardised ones when the R engine supplied them (MIIVsem + lavaan).
      const miiv = results.miiv;
      const est = miiv.estimates;
      const std = !unstd && est.some((e) => e.std !== undefined);
      const val = (e: { est: number; std?: number }) => (std ? e.std ?? null : e.est);
      const loadingOf = new Map<string, number | null>(est.filter((e) => e.op === '=~').map((e) => [e.rhs, val(e)]));
      const markers = new Set(model.constructs.flatMap((k) => (k.indicators.length > 1 ? [k.indicators[0]] : [])));
      for (const m of markers) loadingOf.set(m, std ? miiv.fixedStd?.[m] ?? null : 1);
      return {
        r2: (name: string) => (std || miiv.r2 ? miiv.r2?.[name] ?? null : null),
        indicator: (name: string) => loadingOf.get(name) ?? null,
        fixed: (name: string) => markers.has(name),
        reflectiveThresholds: () => std,
        moderation: (): ModerationLabel | null => null,
        path: (from: string, to: string) => {
          const e = est.find((x) => x.op === '~' && x.lhs === to && x.rhs === from);
          return { beta: e ? val(e) : null, p: e ? e.p : null };
        },
      };
    }
    if (method === 'cbsem' && results.cb) {
      const cb = results.cb;
      // Standardised (std.all) or unstandardised estimates, as chosen on the canvas.
      const ind = new Map(cb.indicators.map((x, k) => [x.name, k]));
      const loading = (name: string) => {
        const k = ind.get(name);
        return k === undefined ? undefined : cb.estimates.find((e) => (e.op === '=~' || e.op === '<~') && e.rhs === name && e.lhs === cb.constructs[cb.indicators[k].construct]);
      };
      return {
        r2: (name: string) => { const j = cb.constructs.indexOf(name); return j >= 0 ? cb.r2Constructs[j] : null; },
        indicator: (name: string) => {
          const k = ind.get(name);
          if (k === undefined) return null;
          // Composites show their weights (as in PLS), common factors their loadings.
          const e = loading(name);
          return unstd ? e?.est ?? null : e?.op === '<~' ? e.std : cb.stdLoadings[k];
        },
        fixed: (name: string) => loading(name)?.kind === 'fixed-loading' || loading(name)?.kind === 'fixed-weight',
        reflectiveThresholds: () => !unstd,
        moderation: (from: string, moderator: string, to: string): ModerationLabel | null => {
          const mo = cb.moderations.find((x) => x.from === from && x.moderator === moderator && x.to === to);
          if (!mo) return null;
          const name = cb.constructs[mo.construct];
          const e = cb.estimates.find((x) => x.op === '~' && x.lhs === to && x.rhs === name);
          return { beta: e ? (unstd ? e.est : e.std) : null, p: e?.p ?? null };
        },
        path: (from: string, to: string) => {
          const i = cb.constructs.indexOf(from), j = cb.constructs.indexOf(to);
          if (i < 0 || j < 0) return { beta: null, p: null };
          const boot = results.boot?.stats.find((s) => s.key === `path:${from}:${to}`)?.p;
          const e = cb.estimates.find((x) => x.op === '~' && x.lhs === to && x.rhs === from);
          return { beta: unstd ? e?.est ?? null : cb.stdPaths[i][j], p: boot ?? e?.p ?? null };
        },
        // A mean is in the variable's units; the standardised form (mean / SD) is what lavaan's std.all gives.
        mean: (name: string) => {
          const e = cb.estimates.find((x) => (x.kind === 'mean' || x.kind === 'intercept') && x.lhs === name);
          return e ? { value: unstd ? e.est : e.std, p: e.p } : null;
        },
      };
    }
    if (method === 'process' && results.process) {
      // Unstandardised OLS coefficients: a path shows the coefficient of its predictor in the
      // outcome's equation (the effect where the moderators are 0), a moderation its product term.
      const eqs = results.process.equations;
      const coef = (to: string, vars: string[]) => {
        const k = [...vars].sort().join('*');
        return eqs.find((e) => e.outcome === to)?.coefficients.find((c) => [...c.term].sort().join('*') === k);
      };
      return {
        r2: (name: string) => eqs.find((e) => e.outcome === name)?.r2 ?? null,
        indicator: () => null,
        reflectiveThresholds: () => false,
        path: (from: string, to: string) => { const c = coef(to, [from]); return { beta: c?.est ?? null, p: c?.p ?? null }; },
        moderation: (from: string, moderator: string, to: string): ModerationLabel | null => {
          const c = coef(to, [from, moderator]);
          return c ? { beta: c.est, p: c.p } : null;
        },
        threeWay: (from: string, w: string, z: string, to: string): ModerationLabel | null => {
          const c = coef(to, [from, w, z]);
          return c ? { beta: c.est, p: c.p } : null;
        },
      };
    }
    if (method === 'pls' && results.pls) {
      const pls = results.pls;
      const idx = new Map(pls.indicators.map((x, k) => [x.name, k]));
      const typeOf = new Map(model.constructs.map((c) => [c.name, c.type]));
      return {
        r2: (name: string) => { const j = pls.constructs.indexOf(name); return j >= 0 ? pls.rSquared[j] : null; },
        indicator: (name: string) => {
          const k = idx.get(name);
          if (k === undefined) return null;
          return typeOf.get(pls.constructs[pls.indicators[k].construct]) === 'composite' ? pls.weights[k] : pls.loadings[k];
        },
        reflectiveThresholds: (type: string) => type === 'factor',
        path: (from: string, to: string) => {
          const i = pls.constructs.indexOf(from), j = pls.constructs.indexOf(to);
          return {
            beta: i >= 0 && j >= 0 ? pls.pathCoef[i][j] : null,
            p: results.boot?.stats.find((s) => s.key === `path:${from}:${to}`)?.p ?? null,
          };
        },
        moderation: (from: string, moderator: string, to: string): ModerationLabel | null => {
          const mo = pls.moderations.find((x) => x.from === from && x.moderator === moderator && x.to === to);
          if (!mo) return null;
          const name = pls.constructs[mo.construct], j = pls.constructs.indexOf(to);
          return { beta: pls.pathCoef[mo.construct][j], p: results.boot?.stats.find((s) => s.key === `path:${name}:${to}`)?.p ?? null };
        },
      };
    }
    return null;
  }, [showResults, results, method, model.constructs, settings.estimator, unstd]);

  /** CB-SEM estimates of correlations and error variances (standardised). */
  const cbEst = showResults && method === 'cbsem' && settings.estimator !== '2SLS' ? results?.cb ?? null : null;
  // MIIV-2SLS (R engine): (co)variances from MIIVsem's var.cov step, without standard errors.
  const miivVar = showResults && method === 'cbsem' && settings.estimator === '2SLS' ? results?.miiv?.variances ?? null : null;
  const correlationLabel = useCallback((k: Correlation): CorrelationLabel | null => {
    if (miivVar) {
      const nameOf = (id: string) => (k.kind === 'construct' ? model.constructs.find((c) => c.id === id)?.name : id);
      const a = nameOf(k.a), b = nameOf(k.b);
      const v = miivVar.find((x) => x.lhs !== x.rhs && x.latent === (k.kind === 'construct') && ((x.lhs === a && x.rhs === b) || (x.lhs === b && x.rhs === a)));
      return v ? { value: unstd ? v.est : v.std, p: null } : null;
    }
    if (!cbEst) return null;
    const nameOf = (id: string) => (k.kind === 'construct' ? model.constructs.find((c) => c.id === id)?.name : id);
    const a = nameOf(k.a), b = nameOf(k.b);
    const e = cbEst.estimates.find((x) => x.op === '~~' && x.lhs !== x.rhs && ((x.lhs === a && x.rhs === b) || (x.lhs === b && x.rhs === a))
      && (k.kind === 'indicator' ? x.kind === 'rescov' : x.kind !== 'rescov'));
    return e ? { value: unstd ? e.est : e.std, p: e.p } : null;
  }, [cbEst, miivVar, model.constructs, unstd]);
  const errorValue = useCallback((kind: Correlation['kind'], name: string): number | null => {
    if (miivVar) {
      const v = miivVar.find((x) => x.lhs === name && x.rhs === name && x.latent === (kind === 'construct'));
      return v ? (unstd ? v.est : v.std) : null;
    }
    if (!cbEst) return null;
    const e = cbEst.estimates.find((x) => x.lhs === name && x.rhs === name && x.op === '~~' && (kind === 'indicator' ? x.kind === 'residual' : x.kind === 'lvcov'));
    return e ? (unstd ? e.est : e.std) : null;
  }, [cbEst, miivVar, unstd]);

  // The estimate of a mean arrow (CB-SEM results only).
  const meanOf = useCallback((name: string): { value: number | null; p: number | null } | null => (display && 'mean' in display && typeof display.mean === 'function' ? display.mean(name) : null), [display]);

  const nodes: FlowNode[] = useMemo(() => [...(model.constant ? [{
    id: 'constant', type: 'constant' as const,
    position: { x: model.constant.x - CONSTANT_R - 4, y: model.constant.y - CONSTANT_R - 2 },
    width: CONSTANT_R * 2 + 8, height: CONSTANT_R * 2 + 4, measured: { width: CONSTANT_R * 2 + 8, height: CONSTANT_R * 2 + 4 },
    selected: selection.nodes.includes('constant'),
    data: { tool, hasError: errorIds.has('constant') },
  } satisfies ConstantFlowNode] : []), ...model.constructs.map((c): ConstructFlowNode => {
    const geom = constructGeometry(c);
    const labels = indicatorLabels(c, method, display, model.esem?.blocks.some((b) => b.constructs.includes(c.id)));
    const w = geom.bounds.w, h = geom.bounds.h;
    return {
      id: c.id,
      type: 'construct',
      position: { x: c.x + geom.bounds.x, y: c.y + geom.bounds.y },
      width: w, height: h, measured: { width: w, height: h },
      selected: selection.nodes.includes(c.id),
      data: {
        construct: c, geom, r2: display?.r2(c.name) ?? null, labels, hasError: errorIds.has(c.id), tool, method,
        picked: picked?.kind === 'construct' && picked.via !== 'disturbance' && picked.id === c.id ? true : picked?.kind === 'indicator' && c.indicators.includes(picked.id) ? picked.id : false,
      },
    };
  })], [model.constructs, model.constant, model.esem?.blocks, selection.nodes, display, errorIds, tool, method, picked]);


  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    let sel: Selection | null = null;
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        if (ch.id === 'constant') { st().moveConstant(ch.position.x + CONSTANT_R + 4, ch.position.y + CONSTANT_R + 2); continue; }
        const c = st().model.constructs.find((k) => k.id === ch.id);
        if (!c) continue;
        const b = constructGeometry(c).bounds;
        st().moveConstruct(ch.id, ch.position.x - b.x, ch.position.y - b.y);
      } else if (ch.type === 'select') {
        sel ??= { ...st().selection, moderations: [] };
        sel.nodes = ch.selected ? [...new Set([...sel.nodes, ch.id])] : sel.nodes.filter((id) => id !== ch.id);
      }
    }
    if (sel) st().setSelection(sel);
  }, [st]);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    let sel: Selection | null = null;
    for (const ch of changes) {
      if (ch.type === 'select') {
        sel ??= { ...st().selection, moderations: [] };
        sel.edges = ch.selected ? [...new Set([...sel.edges, ch.id])] : sel.edges.filter((id) => id !== ch.id);
      }
    }
    if (sel) st().setSelection(sel);
  }, [st]);

  const onDelete: OnDelete<FlowNode, FlowEdge> = useCallback(({ nodes: ns, edges: es }) => {
    st().deleteItems(ns.map((n) => n.id), es.map((e) => e.id));
  }, [st]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target || c.target === 'constant') return;
    if (c.source === 'constant') { st().addMean(c.target); return; }
    st().addPath(c.source, c.target);
  }, [st]);

  // Dropping a connection onto a path (rather than a construct) makes the
  // source construct a moderator of that path.
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
    const pos = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    const { model: m } = st();
    const byId = new Map(m.constructs.map((c) => [c.id, c]));
    let best: { id: string; d: number; moderation?: boolean } | null = null;
    for (const p of m.paths) {
      const seg = pathSegment(byId.get(p.from)!, byId.get(p.to)!, pathOffset(m.paths, p.from, p.to));
      if (!seg) continue;
      const d = distanceToSegment(pos.x, pos.y, seg);
      if (!best || d < best.d) best = { id: p.id, d };
      // Conditional process models: dropping onto a moderation's arrow moderates that moderation.
      if (st().settings.method !== 'process') continue;
      for (const mo of m.moderations) {
        const w = byId.get(mo.moderator);
        if (mo.path !== p.id || !w || w.id === p.from) continue;
        const dm = distanceToSegment(pos.x, pos.y, moderatorSegment(w, seg));
        if (dm < best.d) best = { id: mo.id, d: dm, moderation: true };
      }
    }
    if (!best || best.d > 16 / rf.getViewport().zoom) return;
    if (best.moderation) st().addThreeWay(state.fromNode.id, best.id);
    else st().addModeration(state.fromNode.id, best.id);
  }, [rf, st]);

  const moderationLabel = useCallback((id: string): ModerationLabel | null => {
    if (!display) return null;
    const m = st().model;
    const three = m.threeWay?.find((t) => t.id === id);
    const mo = m.moderations.find((x) => x.id === (three ? three.moderation : id));
    const p = mo && m.paths.find((q) => q.id === mo.path);
    if (!mo || !p) return null;
    const name = (cid: string) => m.constructs.find((c) => c.id === cid)?.name ?? '';
    if (three) return display.threeWay?.(name(p.from), name(mo.moderator), name(three.moderator), name(p.to)) ?? null;
    return display.moderation(name(p.from), name(mo.moderator), name(p.to));
  }, [display, st]);

  const hoLoading = useCallback((parent: string, child: string): HoLabel | null => {
    if (method === 'pls') {
      // Second-order PLS construct: weights into a composite, loadings of a common factor (as for indicators).
      const pls = showResults ? results?.pls : null;
      const h = pls?.higherOrder?.find((x) => pls.constructs[x.construct] === parent && pls.constructs[x.component] === child);
      if (!h) return null;
      return { value: model.constructs.find((k) => k.name === parent)?.type === 'composite' ? h.weight : h.loading, fixed: false };
    }
    if (method !== 'cbsem') return null;
    const par = model.constructs.find((k) => k.name === parent), kid = model.constructs.find((k) => k.name === child);
    const held = kid && par?.componentLoadings?.[kid.id];
    const isMarker = par?.components?.[0] === kid?.id && !par?.markerFree;
    const marker = held !== undefined ? { value: held, fixed: true } : isMarker ? { value: 1, fixed: true } : null;
    if (!showResults) return marker;
    if (settings.estimator === '2SLS') {
      const m = results?.miiv;
      const e = m?.estimates.find((x) => x.op === '=~' && x.lhs === parent && x.rhs === child);
      if (e) return { value: !unstd && e.std !== undefined ? e.std : e.est, fixed: false };
      const fs = m?.fixedStd?.[child];
      return marker && !unstd && fs !== undefined ? { value: fs, fixed: true } : marker;
    }
    const e = results?.cb?.estimates.find((x) => x.op === '=~' && x.lhs === parent && x.rhs === child);
    return e ? { value: unstd ? e.est : e.std, fixed: e.kind === 'fixed-loading' } : marker;
  }, [showResults, method, results, settings.estimator, model.constructs, unstd]);

  // Everything the figure export draws, with the same values as the diagram.
  const [figureOpen, setFigureOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const figureInput = useCallback((): FigureInput => {
    const m = st().model;
    const byId = new Map(m.constructs.map((c) => [c.id, c]));
    const nameOf = (id: string) => byId.get(id)?.name ?? '';
    const lbl = (v: number | null | undefined, p: number | null = null, fixed = false): FigureLabel | null => (v === null || v === undefined ? null : { value: v, p, fixed });
    const constructs = m.constructs.map((c) => {
      const marker = method === 'cbsem' && !c.covariate && c.indicators.length > 0 ? c.indicators[0] : null;
      const indicators = c.indicators.map((name) => {
        const v = display?.indicator(name) ?? null;
        const fixed = (display && 'fixed' in display && !!display.fixed?.(name)) || name === marker;
        return v === null ? (fixed ? { value: 1, p: null, fixed: true } : null) : { value: v, p: null, fixed };
      });
      // CPA: observed variables (single items, mean scores) are drawn as rectangles, latent ones as ellipses.
      const observed = method === 'process' && !(c.latent && c.indicators.length > 1);
      return { c, geom: constructGeometry(c), r2: display?.r2(c.name) ?? null, indicators, ...(observed ? { observed } : {}) };
    });
    // The moderators' implied main effects (dashed), when shown on the canvas.
    const impliedPaths = st().showImpliedEffects ? impliedMainEffects(m).map((e) => ({ id: '', from: e.from, to: e.to, implied: true })) : [];
    const paths = [...m.paths, ...impliedPaths].flatMap((p) => {
      const s = byId.get(p.from), t = byId.get(p.to);
      const seg = s && t ? pathSegment(s, t, pathOffset(m.paths, p.from, p.to)) : null;
      if (!seg) return [];
      const l = display?.path(nameOf(p.from), nameOf(p.to));
      return [{ key: 'implied' in p ? `implied:${p.from}:${p.to}` : p.id, ...seg, label: lbl(l?.beta, l?.p ?? null), moderated: m.moderations.some((mo) => mo.path === p.id), ...('implied' in p ? { implied: true } : {}) }];
    });
    const moderations = m.moderations.flatMap((mo) => {
      const p = m.paths.find((q) => q.id === mo.path);
      const s = p && byId.get(p.from), t = p && byId.get(p.to), mod = byId.get(mo.moderator);
      const seg = s && t ? pathSegment(s, t) : null;
      if (!seg || !mod) return [];
      const l = moderationLabel(mo.id);
      if (mod.id === p!.from) {
        const q = quadraticLoop(mod, seg);
        return [{ key: `mod:${mo.id}`, x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, label: lbl(l?.beta, l?.p ?? null), loop: { ...q, tag: `${mod.name}²` } }];
      }
      return [{ key: `mod:${mo.id}`, ...moderatorSegment(mod, seg), label: lbl(l?.beta, l?.p ?? null) }];
    });
    const higherOrder = m.constructs.flatMap((parent) => (parent.components ?? []).flatMap((cid) => {
      const child = byId.get(cid);
      const seg = child ? (parent.type === 'composite' ? pathSegment(child, parent) : pathSegment(parent, child)) : null;
      if (!seg || !child) return [];
      const l = hoLoading(parent.name, child.name);
      return [{ key: `ho:${parent.id}:${cid}`, ...seg, label: l ? { value: l.value, p: null, fixed: l.fixed } : null }];
    }));
    const cov = covarianceLayout(m, method === 'cbsem', showErrors);
    const errors = [
      ...[...cov.places.entries()].map(([name, { term }]) => ({ term, kind: 'indicator' as const, value: errorValue('indicator', name) })),
      ...cov.disturbances.map(({ c, term }) => ({ term, kind: 'disturbance' as const, value: errorValue('construct', c.name) })),
    ];
    const correlations = cov.curves.map(({ k, curve }) => {
      const l = correlationLabel(k);
      return { d: curve.d, heads: curve.heads, lx: curve.lx, ly: curve.ly, nx: curve.nx, ny: curve.ny,
        points: [[curve.x1, curve.y1], [curve.x2, curve.y2], [curve.lx, curve.ly]] as [number, number][], label: lbl(l?.value, l?.p ?? null) };
    });
    // The constant and its arrows (means and intercepts).
    const constant = m.constant;
    const means = constant ? (m.means ?? []).flatMap((t) => {
      const c = byId.get(t.target);
      const seg = c && meanSegment(constant, c);
      if (!seg) return [];
      const l = meanOf(c.name);
      return [{ key: `mean:${t.id}`, ...seg, label: lbl(l?.value ?? (t.fixed !== undefined ? t.fixed : null), l?.p ?? null, t.fixed !== undefined && l == null) }];
    }) : [];
    const intercepts = constant && st().showImpliedEffects ? impliedIntercepts(m).flatMap((e) => {
      const c = byId.get(e.construct);
      const box = c && constructGeometry(c).indicators.find((b) => b.name === e.indicator);
      const seg = c && box && interceptSegment(constant, c, box);
      if (!seg) return [];
      const l = meanOf(e.indicator);
      return [{ key: `intercept:${e.construct}:${e.indicator}`, ...seg, label: lbl(l?.value ?? null, l?.p ?? null) }];
    }) : [];
    return { constructs, paths, moderations, higherOrder, errors, correlations, ...(constant ? { constant, means, intercepts } : {}) };
  }, [st, method, display, meanOf, moderationLabel, hoLoading, showErrors, errorValue, correlationLabel]);

  // Where each estimate label goes, so that none overlap (the figure export places them the same way).
  const labelAt = useMemo(() => placeFigureLabels(figureInput(), canvasLabelSize), [figureInput]);
  const edges: FlowEdge[] = useMemo(() => {
    const name = new Map(model.constructs.map((c) => [c.id, c.name]));
    const means: MeanFlowEdge[] = model.constant ? (model.means ?? []).flatMap((t): MeanFlowEdge[] => {
      const nm = name.get(t.target);
      if (!nm) return [];
      const l = meanOf(nm);
      return [{ id: t.id, source: 'constant', target: t.target, sourceHandle: 's', targetHandle: 't', type: 'mean', selected: selection.edges.includes(t.id),
        data: { value: l?.value ?? null, p: l?.p ?? null, ...(t.fixed !== undefined ? { fixed: t.fixed } : {}), ...(t.fixed === undefined && t.label ? { label: t.label } : {}), labelAt: labelAt.get(`mean:${t.id}`) } }];
    }) : [];
    const drawn: FlowEdge[] = model.paths.map((p): PathFlowEdge => ({
      id: p.id, source: p.from, target: p.to, sourceHandle: 's', targetHandle: 't', type: 'path',
      selected: selection.edges.includes(p.id),
      data: {
        ...(display ? display.path(name.get(p.from)!, name.get(p.to)!) : { beta: null, p: null }),
        moderated: model.moderations.some((mo) => mo.path === p.id), labelAt: labelAt.get(p.id),
        ...(method === 'cbsem' && p.fixed !== undefined ? { fixed: p.fixed } : {}),
        ...(method === 'cbsem' && p.fixed === undefined && p.label ? { label: p.label } : {}),
      },
    }));
    drawn.push(...means);
    if (!showImplied) return drawn;
    // The intercepts the constant implies (every indicator's, bar a drawn mean's marker): dashed, not editable.
    const intercepts = impliedIntercepts(model).map((e): InterceptFlowEdge => {
      const l = meanOf(e.indicator);
      return { id: `intercept:${e.construct}:${e.indicator}`, source: 'constant', target: e.construct, sourceHandle: 's', targetHandle: 't', type: 'intercept',
        selectable: false, deletable: false, focusable: false, data: { indicator: e.indicator, value: l?.value ?? null, p: l?.p ?? null, labelAt: labelAt.get(`intercept:${e.construct}:${e.indicator}`) } };
    });
    return [...drawn, ...intercepts, ...implied.map((e): PathFlowEdge => ({
      id: `implied:${e.from}:${e.to}`, source: e.from, target: e.to, sourceHandle: 's', targetHandle: 't', type: 'path',
      selectable: false, deletable: false, focusable: false,
      data: { ...(display ? display.path(name.get(e.from)!, name.get(e.to)!) : { beta: null, p: null }), implied: true, labelAt: labelAt.get(`implied:${e.from}:${e.to}`) },
    }))];
  }, [model, selection.edges, display, meanOf, method, implied, showImplied, labelAt]);
  // Model snapshots on the Analyses tab draw the diagram from the canvas.
  useEffect(() => { setFigureSource(figureInput); return () => setFigureSource(null); }, [figureInput]);

  // Right-click menus (canvasMenu.ts decides what each one offers).
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((e: MouseEvent | globalThis.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);
  const startCorrelate = (p: CorrelationPick) => {
    const endError = correlationEndError(st().model, p);
    if (endError) {
      st().toast('info', endError);
      if (!st().showErrorTerms) st().setShowErrorTerms(true);
      return;
    }
    if (p.kind === 'indicator' && !st().showErrorTerms) st().setShowErrorTerms(true);
    if (tool === 'correlate') { setPicked(p); return; }
    pendingPick.current = p;
    st().setTool('correlate');
  };
  /** The parameter a menu target stands for: a path coefficient, a loading or a drawn covariance. */
  const paramOf = (target: MenuTarget): Parameters<ReturnType<typeof st>['fixParameter']>[0] | null =>
    target.kind === 'path' ? { kind: 'path', id: target.id }
      : target.kind === 'indicator' ? { kind: 'loading', construct: target.construct, indicator: target.name }
        : target.kind === 'correlation' ? { kind: 'correlation', id: target.id } : null;
  const fixValue = async (target: MenuTarget) => {
    const t = paramOf(target);
    if (!t) return;
    const m = st().model;
    const current = t.kind === 'path' ? m.paths.find((p) => p.id === t.id)?.fixed
      : t.kind === 'correlation' ? m.correlations?.find((k) => k.id === t.id)?.fixed
        : m.constructs.find((c) => c.id === t.construct)?.fixedLoadings?.[t.indicator];
    const what = t.kind === 'path' ? 'coefficient' : t.kind === 'loading' ? 'loading' : 'covariance';
    const v = await numberDialog({
      title: `Fix the ${what} at a value`,
      body: `CB-SEM holds it at this unstandardised value instead of estimating it (lavaan: value*name), one fewer free parameter. Use it to test a hypothesised value or to set a scale.`,
      confirmLabel: 'Fix',
      field: { label: 'Value', min: -1e6, max: 1e6, initial: current !== undefined ? String(current) : '' },
    });
    if (v !== null) st().fixParameter(t, v);
  };
  const setLabel = async (target: MenuTarget) => {
    const t = paramOf(target);
    if (!t) return;
    const m = st().model;
    const current = t.kind === 'path' ? m.paths.find((p) => p.id === t.id)?.label
      : t.kind === 'correlation' ? m.correlations?.find((k) => k.id === t.id)?.label
        : m.constructs.find((c) => c.id === t.construct)?.loadingLabels?.[t.indicator];
    const variables = new Set([...m.constructs.map((c) => c.name), ...m.constructs.flatMap((c) => c.indicators)]);
    const label = await textDialog({
      title: 'Label this parameter',
      body: 'Parameters with the same label are constrained to be equal. Labels can be used in defined parameters (e.g. ind := a*b) and Wald tests (Model inspector). Leave empty to remove the label.',
      confirmLabel: 'Apply',
      text: { label: 'Label', initial: current ?? '', allowEmpty: true, check: (x) => nameError(x) ?? (variables.has(x) ? 'A label must differ from construct and variable names.' : null) },
    });
    if (label !== null) st().setLabel(t, label || null);
  };
  const onMenuAction = (target: MenuTarget, a: MenuAction) => {
    const s = st();
    switch (a) {
      case 'edit': if (target.kind === 'construct') s.select('construct', target.id); break;
      case 'make-composite': if (target.kind === 'construct') s.updateConstruct(target.id, { type: 'composite' }); break;
      case 'make-factor': if (target.kind === 'construct') s.updateConstruct(target.id, { type: 'factor' }); break;
      case 'correlate':
        if (target.kind === 'indicator') startCorrelate({ kind: 'indicator', id: target.name });
        else if (target.kind === 'disturbance') startCorrelate({ kind: 'construct', id: target.id, via: 'disturbance' });
        else if (target.kind === 'construct') {
          // Endogenous constructs correlate through their disturbance.
          const via = endogenousIds(s.model).has(target.id) ? 'disturbance' as const : undefined;
          startCorrelate({ kind: 'construct', id: target.id, ...(via ? { via } : {}) });
        }
        break;
      case 'delete-construct': if (target.kind === 'construct') s.deleteItems([target.id], []); break;
      case 'remove-indicator': if (target.kind === 'indicator') s.removeIndicator(target.construct, target.name); break;
      case 'reverse-path': if (target.kind === 'path') s.reversePath(target.id); break;
      case 'add-quadratic': if (target.kind === 'path') s.addQuadratic(target.id); break;
      case 'delete-path': if (target.kind === 'path') s.deleteItems([], [target.id]); break;
      case 'delete-moderation': if (target.kind === 'moderation') s.deleteItems([], [], [target.id]); break;
      case 'delete-correlation': if (target.kind === 'correlation') s.deleteItems([], [], [], [target.id]); break;
      case 'add-construct': if (target.kind === 'pane') s.addConstruct(Math.round(target.x), Math.round(target.y)); break;
      case 'arrange': s.layout(); break;
      case 'figure': setFigureOpen(true); break;
      case 'make-covariate': if (target.kind === 'construct') s.updateConstruct(target.id, { covariate: true }); break;
      case 'unmake-covariate': if (target.kind === 'construct') s.updateConstruct(target.id, { covariate: false }); break;
      case 'process-template': setTemplatesOpen(true); break;
      case 'fix-zero': if (target.kind === 'implied') s.addCorrelation('construct', target.a, target.b, true); break;
      case 'fix-value': void fixValue(target); break;
      case 'set-label': void setLabel(target); break;
      case 'make-esem': {
        const m = st().model;
        const free = st().selection.nodes.filter((x) => !m.esem?.blocks.some((b) => b.constructs.includes(x)) && m.constructs.some((c) => c.id === x && !c.covariate && !c.components?.length && c.indicators.length));
        s.setEsem({ rotation: m.esem?.rotation ?? 'geomin', blocks: [...(m.esem?.blocks ?? []), { id: newId('e'), constructs: free }] });
        s.toast('info', 'ESEM block: each of its factors now loads on all the block’s indicators (rotated, geomin). Rotation and blocks are listed in the Model inspector.');
        break;
      }
      case 'leave-esem': {
        const m = st().model;
        if (target.kind === 'construct' && m.esem) s.setEsem({ ...m.esem, blocks: m.esem.blocks.map((b) => ({ ...b, constructs: b.constructs.filter((x) => x !== target.id) })) });
        break;
      }
      case 'toggle-free-path': {
        const mg = st().model.multigroup;
        const p = target.kind === 'path' ? st().model.paths.find((q) => q.id === target.id) : undefined;
        if (!mg || !p) break;
        const same = (f: (typeof mg.free)[number]) => f.kind === 'regression' && f.from === p.from && f.to === p.to;
        s.setMultigroup({ ...mg, free: mg.free.some(same) ? mg.free.filter((f) => !same(f)) : [...mg.free, { kind: 'regression', from: p.from, to: p.to }] });
        break;
      }
      case 'toggle-free-loading':
      case 'toggle-free-intercept': {
        const mg = st().model.multigroup;
        if (target.kind !== 'indicator' || !mg) break;
        const kind = a === 'toggle-free-loading' ? 'loading' : 'intercept';
        const same = (f: (typeof mg.free)[number]) => f.kind === kind && f.indicator === target.name && (f.kind === 'intercept' || f.construct === target.construct);
        s.setMultigroup({ ...mg, free: mg.free.some(same) ? mg.free.filter((f) => !same(f)) : [...mg.free, kind === 'loading' ? { kind, construct: target.construct, indicator: target.name } : { kind, indicator: target.name }] });
        break;
      }
      case 'toggle-ordinal':
        if (target.kind === 'indicator') {
          const on = !(st().model.ordered ?? []).includes(target.name);
          s.setOrdered([target.name], on);
          if (on && st().settings.estimator !== 'WLSMV') s.toast('info', `${target.name} is ordinal now. Ordinal indicators are estimated with WLSMV: choose it under Estimator (Model inspector).`);
        }
        break;
      case 'free-value': {
        const t = paramOf(target);
        if (t) s.fixParameter(t, null);
        break;
      }
    }
  };
  const menuContent = menu ? menuFor(menu.target, model, { method, readOnly, selected: selection.nodes }) : null;

  const isValidConnection = useCallback((c: Connection | FlowEdge) => c.source !== c.target && c.target !== 'constant', []);

  const addAt = (e: MouseEvent) => {
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    st().addConstruct(Math.round(pos.x), Math.round(pos.y));
  };

  const onPaneClick = (e: MouseEvent) => {
    if (tool === 'correlate') setPicked(null);
    else if (tool === 'construct') addAt(e);
    else st().setSelection({ nodes: [], edges: [] });
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(VARS_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    const names = readDraggedVars(e, data?.names ?? []);
    if (!names) return;
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    st().addConstruct(Math.round(pos.x), Math.round(pos.y), names);
  };

  const empty = model.constructs.length === 0;

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      style={figureCssVars(settings.figure) as React.CSSProperties}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerDownCapture={onCorrelateDown}
      // React Flow pans on mousedown (d3-zoom): not when a correlation drag starts on an end.
      onMouseDownCapture={(e) => { if (tool === 'correlate' && !readOnly && e.button === 0 && endAt(e.target as Element)) e.stopPropagation(); }}
      // Collaborators see your pointer anywhere on the canvas (over nodes too).
      onMouseMove={(e) => { const s = currentSession(); if (s) s.setCursor(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}
      onMouseLeave={() => currentSession()?.setCursor(null)}
    >
      <Markers />
      <div className="tool-dock" role="toolbar" aria-label="Canvas tools">
        {tools.map((t) => (
          <button key={t.id} className={`btn ghost${tool === t.id ? ' on' : ''}`} onClick={() => st().setTool(t.id)} title={`${t.label} (${t.key})`}>
            <t.icon /> {t.label} <span className="kbd">{t.key}</span>
          </button>
        ))}
        <div className="sep" />
        <button className="btn ghost" onClick={() => st().layout()} disabled={empty} title="Arrange constructs automatically">
          <IconLayout /> Arrange
        </button>
        {method === 'cbsem' && !readOnly && !model.constant && (
          <button className="btn sm ghost" onClick={() => st().addConstant()} title="Add the constant (a triangle, 1): lavaan’s mean structure. Its arrows are latent means and intercepts.">
            <IconTriangle /> Constant
          </button>
        )}
        <button className="btn ghost" onClick={() => setFigureOpen(true)} disabled={empty} title="Figure style and export (PDF, PNG, SVG)">
          <IconDownload /> Figure
        </button>
        {method === 'cbsem' && (
          <div className="segmented dock-seg" role="radiogroup" aria-label="Estimates on the diagram">
            <button role="radio" aria-checked={!unstd} className={!unstd ? 'on' : ''} onClick={() => st().setEstimateScale('std')} title="Standardised estimates (std.all)">Std</button>
            <button role="radio" aria-checked={unstd} className={unstd ? 'on' : ''} onClick={() => st().setEstimateScale('unstd')} title="Unstandardised estimates (marker loadings are 1)">Unstd</button>
          </div>
        )}
        {(implied.length > 0 || (model.constant && impliedIntercepts(model).length > 0)) && (
          <button className={`btn ghost${showImplied ? ' on' : ''}`} onClick={() => st().setShowImpliedEffects(!showImplied)} aria-pressed={showImplied}
            title={showImplied ? 'Hide what the model implies (dashed: the moderators’ main effects, the constant’s intercepts; they are estimated either way)' : 'Show what the model implies as dashed arrows (the moderators’ main effects, the constant’s intercepts; they are estimated either way)'}>
            Implied
          </button>
        )}
        {method === 'cbsem' && (
          <button className={`btn ghost${showErrors ? ' on' : ''}`} onClick={() => st().setShowErrorTerms(!showErrors)} aria-pressed={showErrors}
            title={showErrors ? 'Hide error terms (ε) and disturbances (ζ)' : 'Show error terms (ε) and disturbances (ζ)'}>
            <IconErrorTerm /> Errors
          </button>
        )}
      </div>
      {tool === 'correlate' && (
        <div className="tool-hint" role="status">
          {picked
            ? <>Now click the second {picked.kind === 'indicator' ? 'indicator' : picked.via === 'disturbance' ? 'disturbance (ζ)' : 'exogenous construct'}. Esc cancels.</>
            : <>Drag from one end to the other, or click both: two exogenous constructs, two disturbances (ζ) of endogenous constructs, or two indicators (correlated errors).</>}
        </div>
      )}
      {rubber && (
        <svg className="rubber" aria-hidden="true">
          <path d={`M ${rubber.x1} ${rubber.y1} Q ${(rubber.x1 + rubber.x2) / 2 - (rubber.y2 - rubber.y1) * 0.25} ${(rubber.y1 + rubber.y2) / 2 + (rubber.x2 - rubber.x1) * 0.25} ${rubber.x2} ${rubber.y2}`} />
        </svg>
      )}

      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={() => st().checkpoint()}
        onNodeClick={(e, node) => {
          if (tool !== 'correlate' || readOnly) return;
          const ind = (e.target as Element).closest('[data-ind]')?.getAttribute('data-ind');
          pick(ind ? { kind: 'indicator', id: ind } : { kind: 'construct', id: node.id });
        }}
        onNodeContextMenu={(e, node) => {
          const ind = (e.target as Element).closest('[data-ind]')?.getAttribute('data-ind');
          if (!ind && !st().selection.nodes.includes(node.id)) st().select('construct', node.id);
          openMenu(e, ind ? { kind: 'indicator', construct: node.id, name: ind } : { kind: 'construct', id: node.id });
        }}
        onEdgeContextMenu={(e, edge) => { st().select('path', edge.id); openMenu(e, { kind: 'path', id: edge.id }); }}
        onPaneContextMenu={(e) => {
          // Layers drawn over the pane (correlations, moderators, error terms) open their own menus.
          if (!(e.target as Element).classList.contains('react-flow__pane')) return;
          const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          openMenu(e, { kind: 'pane', x: pos.x, y: pos.y });
        }}
        elementsSelectable={tool !== 'correlate'}
        onDelete={onDelete}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd as never}
        isValidConnection={isValidConnection}
        connectionLineComponent={ConnectionLine}
        onPaneClick={onPaneClick}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('react-flow__pane')) addAt(e);
        }}
        zoomOnDoubleClick={false}
        deleteKeyCode={readOnly || workspace !== 'model' ? null : ['Backspace', 'Delete']}
        nodesConnectable={!readOnly}
        multiSelectionKeyCode={['Meta', 'Shift', 'Control']}
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'select' ? [1, 2] : true}
        nodesDraggable={tool !== 'connect' && tool !== 'correlate' && !readOnly}
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        // (first fit, before the bars can be measured: the tool dock's usual extent)
        fitViewOptions={{ padding: fitPadding(method === 'cbsem' ? 0.35 : 0.2, method === 'process' ? 140 : 60), maxZoom: 1.1 }}
        attributionPosition="top-right"
        style={{ cursor: tool === 'construct' ? 'copy' : undefined }}
      >
        <ModeratorLayer labelFor={moderationLabel} onMenu={openMenu} labelAt={(id) => labelAt.get(`mod:${id}`) ?? null} />
        <HigherOrderLayer loadingFor={hoLoading} labelAt={(parent, child) => labelAt.get(`ho:${parent}:${child}`) ?? null} />
        <CovarianceLayer active={method === 'cbsem'} showErrors={showErrors} picked={picked}
          onPick={tool === 'correlate' && !readOnly ? pick : null} labelFor={correlationLabel} errorFor={errorValue} onMenu={openMenu} />
        <PresenceLayer />
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#c9ceda" />
        <Controls showInteractive={false} position="bottom-left" showFitView={false}>
          <ControlButton onClick={() => void rf.fitView({ ...fitOptions(), duration: 250 })} title="Fit view" aria-label="Fit view"><IconFitView /></ControlButton>
        </Controls>
        {!empty && <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 96 }} nodeColor="#c7cbff" maskColor="rgba(244,245,248,0.7)" />}
      </ReactFlow>

      {empty && (
        <div className="canvas-empty">
          <div className="card">
            <IconSparkle size={22} style={{ color: 'var(--accent)' }} />
            <h2>{method === 'process' ? 'Build a conditional process model' : method === 'cbsem' ? 'Build a structural equation model' : 'Build a PLS path model'}</h2>
            {method === 'process' ? (
              <>
                <p>Pick one of Hayes’s PROCESS models (mediation, moderation, moderated mediation) and drag your variables onto its slots, or draw your own model: one X, one Y, mediators between them, and moderators pointing at paths.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" onClick={() => setTemplatesOpen(true)} disabled={readOnly}><IconSparkle size={14} /> Choose a PROCESS model</button>
                  {!data && <button className="btn" onClick={onImport}><IconUpload /> Import CSV</button>}
                </div>
              </>
            ) : data ? (
              <ol className="steps">
                <li>Drag variables from the left panel onto the canvas to create a construct.</li>
                <li>Drop more variables on a construct to add indicators.</li>
                <li>Drag from a construct's right-hand dot to another construct to add a path.</li>
                <li>Press <b>Calculate</b>.</li>
              </ol>
            ) : (
              <>
                <p>Import a CSV with one column per indicator (or a labelled covariance matrix), or explore a ready-made example.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" onClick={onImport}><IconUpload /> Import CSV</button>
                  <button className="btn" onClick={() => onSample('customer')}>Load example</button>
                  <button className="btn" onClick={() => onSample('emse')} title="Stol, Schaarschmidt & Goldblit (2022), EMSE: CB-SEM from published covariance matrices">CB-SEM example</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {menu && menuContent && (
        <ContextMenu x={menu.x} y={menu.y} title={menuContent.title} items={menuContent.items}
          onAction={(a) => onMenuAction(menu.target, a)} onClose={closeMenu} />
      )}
      {figureOpen && <FigurePanel input={figureInput} onClose={() => setFigureOpen(false)} />}
      {templatesOpen && <ProcessGallery onClose={() => setTemplatesOpen(false)} />}
      {method === 'process' && !empty && <ProcessBar onTemplates={() => setTemplatesOpen(true)} />}
      <ModelVersionBadge />
      {hasStaleResults && !empty && (
        <div className="stale-banner">
          Model changed since the last calculation.
          <button className="btn sm primary" onClick={() => run('estimate')}><IconPlay size={13} /> Recalculate</button>
        </div>
      )}
    </div>
  );
}
