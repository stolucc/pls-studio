// The canvas's React Flow nodes and edges, and the figure they share with the export: estimate labels are placed
// on the figure (placeFigureLabels) so that none overlap, and the edges draw them there.

import { useCallback, useEffect, useMemo } from 'react';
import { CONSTANT_R, constructGeometry } from '../../geometry';
import { formatEstimate } from '../../figure/style';
import type { FigureInput } from '../../figure/render';
import { buildFigureInput } from '../../figure/build';
import { canvasLabelSize, placeFigureLabels } from '../../figure/labels';
import { setFigureSource } from '../../figure/source';
import { constantDrawn, impliedIntercepts, validateModel, type ModelState } from '../../model/project';
import type { PlacedModel } from '../../placement';
import { useStore, type Results, type Selection, type Tool } from '../../store';
import { indicatorLabels } from '../../diagramLabels';
import type { ConstantFlowNode } from '../ConstantNode';
import type { ConstructFlowNode } from '../ConstructNode';
import { copulaEstimate } from '../CopulaLayer';
import type { CorrelationPick } from '../CovarianceLayer';
import type { InterceptFlowEdge } from '../InterceptEdge';
import type { MeanFlowEdge } from '../MeanEdge';
import { NOTE_WIDTH, type NoteFlowNode } from '../NoteNode';
import type { PathFlowEdge } from '../PathEdge';
import type { useEstimateLabels } from './estimates';

export type FlowNode = ConstructFlowNode | ConstantFlowNode | NoteFlowNode;
export type FlowEdge = PathFlowEdge | MeanFlowEdge | InterceptFlowEdge;

/** What the graph is built from: the model (and its placement), what is selected and shown, and the estimates. */
export interface FlowGraphInput {
  model: ModelState; placed: PlacedModel; selection: Selection; tool: Tool; picked: CorrelationPick | null;
  /** The moderators' main effects the diagram does not draw, and whether they are shown. */
  implied: { from: string; to: string }[]; showImplied: boolean;
  showErrors: boolean; showIntercepts: boolean; unstd: boolean;
  /** The current results (useFreshResults). */
  results: Results | null;
  estimates: ReturnType<typeof useEstimateLabels>;
}

/** The nodes, the edges (labels placed) and the figure of the canvas; the figure is also the Analyses tab's snapshot source. */
export function useFlowGraph({ model, placed, selection, tool, picked, implied, showImplied, showErrors, showIntercepts, unstd, results, estimates }: FlowGraphInput) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const method = settings.method;
  const { display, correlationLabel, errorValue, meanOf, moderationLabel, hoLoading } = estimates;
  const errorIds = useMemo(
    () => new Set(validateModel(model, data, settings).filter((i) => i.level === 'error' && i.constructId).map((i) => i.constructId!)),
    [model, data, settings],
  );

  const constantShown = constantDrawn(model, showIntercepts);
  const nodes: FlowNode[] = useMemo(() => [...(model.constant && constantShown ? [{
    id: 'constant', type: 'constant' as const,
    position: { x: model.constant.x - CONSTANT_R - 4, y: model.constant.y - CONSTANT_R - 2 },
    width: CONSTANT_R * 2 + 8, height: CONSTANT_R * 2 + 4, measured: { width: CONSTANT_R * 2 + 8, height: CONSTANT_R * 2 + 4 },
    selected: selection.nodes.includes('constant'),
    data: { tool, hasError: errorIds.has('constant') },
  } satisfies ConstantFlowNode] : []), ...(model.notes ?? []).map((k): NoteFlowNode => ({
    id: k.id, type: 'note', position: { x: k.x, y: k.y }, width: NOTE_WIDTH, selected: selection.nodes.includes(k.id), data: { text: k.text },
  })), ...placed.constructs.map((c): ConstructFlowNode => {
    const geom = constructGeometry(c);
    const labels = indicatorLabels(c, method, display, model.esem?.blocks.some((b) => b.constructs.includes(c.id)), (v) => formatEstimate(settings.figure, v));
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
  })], [constantShown, placed.constructs, model.constant, model.esem?.blocks, model.notes, selection.nodes, display, errorIds, tool, method, picked, settings.figure]);

  const figureInput = useCallback((): FigureInput => buildFigureInput(placed, method, {
    indicator: display ? (name, construct) => display.indicator(name, construct) : undefined,
    fixed: display && 'fixed' in display ? display.fixed : undefined,
    r2: display ? (name) => display.r2(name) : undefined,
    path: display ? (from, to) => display.path(from, to) : undefined,
    moderation: moderationLabel,
    higherOrder: hoLoading,
    error: errorValue,
    correlation: correlationLabel,
    mean: meanOf,
    copula: (from, to) => copulaEstimate(results?.pls, results?.boot, from, to),
  }, { showErrors, showIntercepts, showImpliedEffects: showImplied, unstd }), [placed, method, display, meanOf, moderationLabel, hoLoading, showErrors, showIntercepts, showImplied, errorValue, correlationLabel, unstd, results]);

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
        moderated: model.moderations.some((mo) => mo.path === p.id), labelAt: labelAt.get(p.id), line: p.line, curved: p.curved,
        ...(method === 'cbsem' && p.fixed !== undefined ? { fixed: p.fixed } : {}),
        ...(method === 'cbsem' && p.fixed === undefined && p.label ? { label: p.label } : {}),
        ...(method === 'cbsem' && p.optional ? { optional: true } : {}),
      },
    }));
    drawn.push(...means);
    // The intercepts the constant implies (every indicator's, bar a drawn mean's marker): dashed, not editable.
    const intercepts = (showIntercepts ? impliedIntercepts(model) : []).map((e): InterceptFlowEdge => {
      const l = meanOf(e.indicator);
      return { id: `intercept:${e.construct}:${e.indicator}`, source: 'constant', target: e.construct, sourceHandle: 's', targetHandle: 't', type: 'intercept',
        selectable: false, deletable: false, focusable: false, data: { indicator: e.indicator, value: l?.value ?? null, p: l?.p ?? null, labelAt: labelAt.get(`intercept:${e.construct}:${e.indicator}`) } };
    });
    return [...drawn, ...intercepts, ...(showImplied ? implied : []).map((e): PathFlowEdge => ({
      id: `implied:${e.from}:${e.to}`, source: e.from, target: e.to, sourceHandle: 's', targetHandle: 't', type: 'path',
      selectable: false, deletable: false, focusable: false,
      data: { ...(display ? display.path(name.get(e.from)!, name.get(e.to)!) : { beta: null, p: null }), implied: true, labelAt: labelAt.get(`implied:${e.from}:${e.to}`) },
    }))];
  }, [model, selection.edges, display, meanOf, method, implied, showImplied, showIntercepts, labelAt]);
  // Model snapshots on the Analyses tab draw the diagram from the canvas.
  useEffect(() => { setFigureSource(figureInput); return () => setFigureSource(null); }, [figureInput]);
  return { nodes, edges, figureInput, labelAt };
}
