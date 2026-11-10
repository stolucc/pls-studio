import type React from 'react';
import { Background, BackgroundVariant, ControlButton, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { figureCssVars, figureForMethod, isPlainFigure } from '../figure/style';
import { FigurePanel } from './FigurePanel';
import { ProcessGallery } from './ProcessGallery';
import { ProcessBar } from './ProcessBar';
import { ModelVersionBadge } from './ModelVersionBadge';
import { fitPadding, overlayBottom } from '../canvasFit';
import { ContextMenu } from './ContextMenu';
import { menuFor, type MenuAction, type MenuTarget } from './canvasMenu';
import { impliedMainEffects } from '../model/project';
import { endAt } from './correlationEnds';
import { run } from '../runner';
import { resultsKey, selectPlacedModel, useFreshResults, useStore } from '../store';
import { ConstructNode } from './ConstructNode';
import { ConstantNode } from './ConstantNode';
import { InterceptEdge } from './InterceptEdge';
import { MeanEdge } from './MeanEdge';
import { IconFitView, IconPlay } from './icons';
import { CovarianceLayer } from './CovarianceLayer';
import { currentSession } from '../cloud/collab';
import { PresenceLayer } from './cloud/Presence';
import { HigherOrderLayer } from './HigherOrderLayer';
import { NoteNode } from './NoteNode';
import { ParcelDialog } from './ParcelDialog';
import { CopulaLayer } from './CopulaLayer';
import { ModeratorLayer } from './ModeratorLayer';
import { PathEdge } from './PathEdge';
import { ExampleBanner } from './ExampleBanner';
import { CanvasEmpty, ConnectionLine, Markers, ToolDock } from './canvas/CanvasChrome';
import { useEstimateLabels } from './canvas/estimates';
import { runMenuAction } from './canvas/menuActions';
import { useCorrelationTool } from './canvas/useCorrelationTool';
import { useFlowGraph, type FlowEdge, type FlowNode } from './canvas/useFlowGraph';
import { useFlowHandlers } from './canvas/useFlowHandlers';

const nodeTypes = { construct: ConstructNode, constant: ConstantNode, note: NoteNode };
const edgeTypes = { path: PathEdge, mean: MeanEdge, intercept: InterceptEdge };

interface EmptyProps { onImport: () => void }

export function Canvas({ onImport }: EmptyProps) {
  const model = useStore((s) => s.model);
  // (laid out under the figure style: what geometry is computed from)
  const placed = useStore(selectPlacedModel);
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
  const showIntercepts = useStore((s) => s.showIntercepts);
  const scale = useStore((s) => s.estimateScale);
  const unstd = scale === 'unstd';
  const method = settings.method;
  // Moderators' main effects on the outcome that the diagram does not draw (estimated anyway).
  // (CPA too: Hayes's statistical diagrams draw them; PROCESS estimates them.)
  const implied = useMemo(() => impliedMainEffects(model), [model]);
  const estimates = useEstimateLabels(model, method, settings.estimator, results, showResults, unstd);
  const { display, correlationLabel, errorValue, moderationLabel, hoLoading } = estimates;
  const { picked, setPicked, pick, rubber, onCorrelateDown, startCorrelate } = useCorrelationTool(tool, method, readOnly);
  const { onNodesChange, onEdgesChange, onDelete, onConnect, onConnectEnd, isValidConnection, addAt, onPaneClick, onDragOver, onDrop } = useFlowHandlers(tool, data, setPicked);

  const [figureOpen, setFigureOpen] = useState(false);
  const [parcelFor, setParcelFor] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // The nodes and edges, and everything the figure export draws, with the same values as the diagram.
  const { nodes, edges, figureInput, labelAt } = useFlowGraph({ model, placed, selection, tool, picked, implied, showImplied, showErrors, showIntercepts, unstd, results, estimates });

  // Right-click menus (canvasMenu.ts decides what each one offers).
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((e: MouseEvent | globalThis.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);
  const onMenuAction = (target: MenuTarget, a: MenuAction) => runMenuAction(target, a, { startCorrelate, setParcelFor, setFigureOpen, setTemplatesOpen });
  const menuContent = menu ? menuFor(menu.target, model, { method, readOnly, selected: selection.nodes }) : null;

  const empty = model.constructs.length === 0;

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap${isPlainFigure(settings.figure) ? ' plain-figure' : ''}${settings.figure.notation === 'amos' ? ' amos-notation' : ''}${settings.figure.notation === 'semplot' ? ' semplot-notation' : ''}${settings.figure.notation === 'pls' ? ` pls-notation ${method === 'cbsem' ? 'pls-notation-cb' : 'pls-notation-pls'}` : ''}`}
      style={figureCssVars(figureForMethod(settings.figure, method)) as React.CSSProperties}
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
      <ToolDock empty={empty} implied={implied} onFigure={() => setFigureOpen(true)} />
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
        <CopulaLayer pls={results?.pls} boot={results?.boot} onMenu={openMenu} />
        <ModeratorLayer labelFor={moderationLabel} onMenu={openMenu} labelAt={(id) => labelAt.get(`mod:${id}`) ?? null} />
        <HigherOrderLayer loadingFor={hoLoading} labelAt={(parent, child) => labelAt.get(`ho:${parent}:${child}`) ?? null} />
        <CovarianceLayer active={method === 'cbsem'} showErrors={showErrors} picked={picked}
          onPick={tool === 'correlate' && !readOnly ? pick : null} labelFor={correlationLabel} errorFor={errorValue} unstd={unstd} onMenu={openMenu} loadingFor={(i, n) => display?.indicator(i, n) ?? null} />
        <PresenceLayer />
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#c9ceda" />
        <Controls showInteractive={false} position="bottom-left" showFitView={false}>
          <ControlButton onClick={() => void rf.fitView({ ...fitOptions(), duration: 250 })} title="Fit view" aria-label="Fit view"><IconFitView /></ControlButton>
        </Controls>
        {!empty && <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 96 }} nodeColor="#c7cbff" maskColor="rgba(244,245,248,0.7)" />}
      </ReactFlow>
      <ExampleBanner where="model" />

      {/* (hidden once the Construct tool is chosen, so that the first click on the canvas places a construct) */}
      {empty && tool !== 'construct' && (
        <CanvasEmpty method={method} data={data} readOnly={readOnly} onImport={onImport} onTemplates={() => setTemplatesOpen(true)} />
      )}

      {menu && menuContent && (
        <ContextMenu x={menu.x} y={menu.y} title={menuContent.title} items={menuContent.items}
          onAction={(a) => onMenuAction(menu.target, a)} onClose={closeMenu} />
      )}
      {figureOpen && <FigurePanel input={figureInput} onClose={() => setFigureOpen(false)} />}
      {parcelFor && model.constructs.some((k) => k.id === parcelFor) && <ParcelDialog c={model.constructs.find((k) => k.id === parcelFor)!} onClose={() => setParcelFor(null)} />}
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
