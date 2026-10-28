import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow,
  type Connection, type ConnectionLineComponentProps, type EdgeChange, type FinalConnectionState, type NodeChange, type OnDelete,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { constructGeometry, distanceToSegment, pathSegment } from '../geometry';
import { correlationEndError, correlationPairError, validateModel, type Correlation } from '../model/project';
import type { ExampleId } from '../io';
import { run } from '../runner';
import { resultsKey, useFreshResults, useStore, type Selection, type Tool } from '../store';
import { ConstructNode, type ConstructFlowNode } from './ConstructNode';
import { indicatorLabels } from '../diagramLabels';
import { readDraggedVars, VARS_MIME } from './dnd';
import { IconArrow, IconCorrelate, IconEllipse, IconErrorTerm, IconLayout, IconPlay, IconPointer, IconSparkle, IconUpload } from './icons';
import { CovarianceLayer, type CorrelationLabel, type CorrelationPick } from './CovarianceLayer';
import { currentSession } from '../cloud/collab';
import { PresenceLayer } from './cloud/Presence';
import { HigherOrderLayer, type HoLabel } from './HigherOrderLayer';
import { ModeratorLayer, type ModerationLabel } from './ModeratorLayer';
import { PathEdge, type PathFlowEdge } from './PathEdge';

const nodeTypes = { construct: ConstructNode };
const edgeTypes = { path: PathEdge };

function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  return <path d={`M ${fromX} ${fromY} L ${toX} ${toY}`} stroke="var(--accent)" strokeWidth={1.8} strokeDasharray="5 4" fill="none" markerEnd="url(#arrow-path-sel)" />;
}

function Markers() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <marker id="arrow-ind" viewBox="0 0 10 10" refX={9.5} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="#9aa3b5" />
        </marker>
        <marker id="arrow-path" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--path)" />
        </marker>
        <marker id="arrow-path-sel" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
        <marker id="arrow-mod" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="#8b5cf6" />
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
  useEffect(() => {
    if (fitRequest === 0) return;
    // fitView frames nodes only; correlation arcs and error terms reach beyond them.
    const extra = st().settings.method === 'cbsem' ? 0.15 : 0;
    const t = setTimeout(() => void rf.fitView({ padding: 0.2 + extra, maxZoom: 1.1, duration: 250 }), 40);
    return () => clearTimeout(t);
  }, [fitRequest, rf, st]);

  const settings = useStore((s) => s.settings);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const showErrors = useStore((s) => s.showErrorTerms);
  const scale = useStore((s) => s.estimateScale);
  const unstd = scale === 'unstd';
  const method = settings.method;
  const tools = method === 'cbsem' ? TOOLS : TOOLS.filter((t) => t.id !== 'correlate');

  // Correlation tool: the first end picked, waiting for the second.
  const [picked, setPicked] = useState<CorrelationPick | null>(null);
  useEffect(() => { setPicked(null); }, [tool]);
  useEffect(() => { if (method !== 'cbsem' && tool === 'correlate') st().setTool('select'); }, [method, tool, st]);
  const pick = useCallback((p: CorrelationPick) => {
    const endError = correlationEndError(st().model, p);
    if (endError) {
      st().toast('info', endError);
      if (!st().showErrorTerms) st().setShowErrorTerms(true);
      return;
    }
    if (!picked) { setPicked(p); return; }
    if (picked.kind === p.kind && picked.id === p.id) { setPicked(null); return; }
    const pairError = correlationPairError(st().model, picked, p);
    if (pairError) {
      st().toast('error', pairError);
      setPicked(null);
      return;
    }
    st().addCorrelation(p.kind, picked.id, p.id);
    setPicked(null);
  }, [picked, st]);
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
        return k === undefined ? undefined : cb.estimates.find((e) => e.op === '=~' && e.rhs === name && e.lhs === cb.constructs[cb.indicators[k].construct]);
      };
      return {
        r2: (name: string) => { const j = cb.constructs.indexOf(name); return j >= 0 ? cb.r2Constructs[j] : null; },
        indicator: (name: string) => {
          const k = ind.get(name);
          if (k === undefined) return null;
          return unstd ? loading(name)?.est ?? null : cb.stdLoadings[k];
        },
        fixed: (name: string) => loading(name)?.kind === 'fixed-loading',
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

  const nodes: ConstructFlowNode[] = useMemo(() => model.constructs.map((c) => {
    const geom = constructGeometry(c);
    const labels = indicatorLabels(c, method, display);
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
  }), [model.constructs, selection.nodes, display, errorIds, tool, method, picked]);

  const edges: PathFlowEdge[] = useMemo(() => {
    const name = new Map(model.constructs.map((c) => [c.id, c.name]));
    return model.paths.map((p) => ({
      id: p.id, source: p.from, target: p.to, sourceHandle: 's', targetHandle: 't', type: 'path',
      selected: selection.edges.includes(p.id),
      data: {
        ...(display ? display.path(name.get(p.from)!, name.get(p.to)!) : { beta: null, p: null }),
        moderated: model.moderations.some((mo) => mo.path === p.id),
      },
    }));
  }, [model.paths, model.constructs, model.moderations, selection.edges, display]);

  const onNodesChange = useCallback((changes: NodeChange<ConstructFlowNode>[]) => {
    let sel: Selection | null = null;
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
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

  const onEdgesChange = useCallback((changes: EdgeChange<PathFlowEdge>[]) => {
    let sel: Selection | null = null;
    for (const ch of changes) {
      if (ch.type === 'select') {
        sel ??= { ...st().selection, moderations: [] };
        sel.edges = ch.selected ? [...new Set([...sel.edges, ch.id])] : sel.edges.filter((id) => id !== ch.id);
      }
    }
    if (sel) st().setSelection(sel);
  }, [st]);

  const onDelete: OnDelete<ConstructFlowNode, PathFlowEdge> = useCallback(({ nodes: ns, edges: es }) => {
    st().deleteItems(ns.map((n) => n.id), es.map((e) => e.id));
  }, [st]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.source !== c.target) st().addPath(c.source, c.target);
  }, [st]);

  // Dropping a connection onto a path (rather than a construct) makes the
  // source construct a moderator of that path.
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
    const pos = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    const { model: m } = st();
    const byId = new Map(m.constructs.map((c) => [c.id, c]));
    let best: { id: string; d: number } | null = null;
    for (const p of m.paths) {
      const seg = pathSegment(byId.get(p.from)!, byId.get(p.to)!);
      if (!seg) continue;
      const d = distanceToSegment(pos.x, pos.y, seg);
      if (!best || d < best.d) best = { id: p.id, d };
    }
    if (best && best.d <= 16 / rf.getViewport().zoom) st().addModeration(state.fromNode.id, best.id);
  }, [rf, st]);

  const moderationLabel = useCallback((id: string): ModerationLabel | null => {
    if (!display) return null;
    const m = st().model;
    const mo = m.moderations.find((x) => x.id === id);
    const p = mo && m.paths.find((q) => q.id === mo.path);
    if (!mo || !p) return null;
    const name = (cid: string) => m.constructs.find((c) => c.id === cid)?.name ?? '';
    return display.moderation(name(p.from), name(mo.moderator), name(p.to));
  }, [display, st]);

  const hoLoading = useCallback((parent: string, child: string): HoLabel | null => {
    if (method !== 'cbsem') return null;
    const isMarker = model.constructs.find((k) => k.name === parent)?.components?.[0] === model.constructs.find((k) => k.name === child)?.id;
    const marker = isMarker ? { value: 1, fixed: true } : null;
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

  const isValidConnection = useCallback((c: Connection | PathFlowEdge) => c.source !== c.target, []);

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
      className="canvas-wrap"
      onDragOver={onDragOver}
      onDrop={onDrop}
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
        {method === 'cbsem' && (
          <div className="segmented dock-seg" role="radiogroup" aria-label="Estimates on the diagram">
            <button role="radio" aria-checked={!unstd} className={!unstd ? 'on' : ''} onClick={() => st().setEstimateScale('std')} title="Standardised estimates (std.all)">Std</button>
            <button role="radio" aria-checked={unstd} className={unstd ? 'on' : ''} onClick={() => st().setEstimateScale('unstd')} title="Unstandardised estimates (marker loadings are 1)">Unstd</button>
          </div>
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
            : <>Click two exogenous constructs, two disturbances (ζ) of endogenous constructs, or two indicators (correlated errors).</>}
        </div>
      )}

      <ReactFlow<ConstructFlowNode, PathFlowEdge>
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
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        nodesConnectable={!readOnly}
        multiSelectionKeyCode={['Meta', 'Shift', 'Control']}
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'select' ? [1, 2] : true}
        nodesDraggable={tool !== 'connect' && tool !== 'correlate' && !readOnly}
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: method === 'cbsem' ? 0.4 : 0.25, maxZoom: 1.1 }}
        attributionPosition="top-right"
        style={{ cursor: tool === 'construct' ? 'copy' : undefined }}
      >
        <ModeratorLayer labelFor={moderationLabel} />
        <HigherOrderLayer loadingFor={hoLoading} />
        <CovarianceLayer active={method === 'cbsem'} showErrors={showErrors} picked={picked}
          onPick={tool === 'correlate' && !readOnly ? pick : null} labelFor={correlationLabel} errorFor={errorValue} />
        <PresenceLayer />
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#c9ceda" />
        <Controls showInteractive={false} position="bottom-left" fitViewOptions={{ padding: method === 'cbsem' ? 0.4 : 0.25, maxZoom: 1.1 }} />
        {!empty && <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 96 }} nodeColor="#c7cbff" maskColor="rgba(244,245,248,0.7)" />}
      </ReactFlow>

      {empty && (
        <div className="canvas-empty">
          <div className="card">
            <IconSparkle size={22} style={{ color: 'var(--accent)' }} />
            <h2>Build a PLS path model</h2>
            {data ? (
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

      {hasStaleResults && !empty && (
        <div className="stale-banner">
          Model changed since the last calculation.
          <button className="btn sm primary" onClick={() => run('estimate')}><IconPlay size={13} /> Recalculate</button>
        </div>
      )}
    </div>
  );
}
