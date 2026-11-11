// React Flow's handlers for the canvas: moving and selecting, deleting, connecting (a path, a mean, or a moderation
// when dropped onto an arrow), adding constructs by clicking or dropping variables.

import {
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnDelete,
} from '@xyflow/react';
import { useCallback, type DragEvent, type MouseEvent } from 'react';
import type { Dataset } from '../../engine/types';
import {
  CONSTANT_R,
  constructGeometry,
  distanceToSegment,
  moderatorSegment,
  pathOffset,
  pathSegment,
} from '../../geometry';
import { selectPlacedModel, useStore, type Selection, type Tool } from '../../store';
import type { CorrelationPick } from '../CovarianceLayer';
import { readDraggedVars, VARS_MIME } from '../dnd';
import type { FlowEdge, FlowNode } from './useFlowGraph';

/** The canvas's React Flow handlers. */
export function useFlowHandlers(
  tool: Tool,
  data: Dataset | null,
  setPicked: (p: CorrelationPick | null) => void,
) {
  const st = useStore.getState;
  const rf = useReactFlow();
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      let sel: Selection | null = null;
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          if (ch.id === 'constant') {
            st().moveConstant(ch.position.x + CONSTANT_R + 4, ch.position.y + CONSTANT_R + 2);
            continue;
          }
          if (ch.id.startsWith('note-')) {
            st().moveNote(ch.id, ch.position.x, ch.position.y);
            continue;
          }
          const c = selectPlacedModel(st()).constructs.find((k) => k.id === ch.id);
          if (!c) continue;
          const b = constructGeometry(c).bounds;
          st().moveConstruct(ch.id, ch.position.x - b.x, ch.position.y - b.y);
        } else if (ch.type === 'select') {
          sel ??= { ...st().selection, moderations: [] };
          sel.nodes = ch.selected
            ? [...new Set([...sel.nodes, ch.id])]
            : sel.nodes.filter((id) => id !== ch.id);
        }
      }
      if (sel) st().setSelection(sel);
    },
    [st],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      let sel: Selection | null = null;
      for (const ch of changes) {
        if (ch.type === 'select') {
          sel ??= { ...st().selection, moderations: [] };
          sel.edges = ch.selected
            ? [...new Set([...sel.edges, ch.id])]
            : sel.edges.filter((id) => id !== ch.id);
        }
      }
      if (sel) st().setSelection(sel);
    },
    [st],
  );

  const onDelete: OnDelete<FlowNode, FlowEdge> = useCallback(
    ({ nodes: ns, edges: es }) => {
      st().deleteItems(
        ns.map((n) => n.id),
        es.map((e) => e.id),
      );
    },
    [st],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target || c.target === 'constant') return;
      if (c.source === 'constant') {
        st().addMean(c.target);
        return;
      }
      st().addPath(c.source, c.target);
    },
    [st],
  );

  // Dropping a connection onto a path (rather than a construct) makes the
  // source construct a moderator of that path.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
      const pos = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      const m = selectPlacedModel(st());
      const byId = new Map(m.constructs.map((c) => [c.id, c]));
      let best: { id: string; d: number; moderation?: boolean } | null = null;
      for (const p of m.paths) {
        const seg = pathSegment(
          byId.get(p.from)!,
          byId.get(p.to)!,
          pathOffset(m.paths, p.from, p.to),
        );
        if (!seg) continue;
        const d = distanceToSegment(pos.x, pos.y, seg);
        if (!best || d < best.d) best = { id: p.id, d };
        // PLS-SEM and conditional process models: dropping onto a moderation's arrow moderates that moderation.
        if (st().settings.method === 'cbsem') continue;
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
    },
    [rf, st],
  );

  const isValidConnection = useCallback(
    (c: Connection | FlowEdge) => c.source !== c.target && c.target !== 'constant',
    [],
  );

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
  return {
    onNodesChange,
    onEdgesChange,
    onDelete,
    onConnect,
    onConnectEnd,
    isValidConnection,
    addAt,
    onPaneClick,
    onDragOver,
    onDrop,
  };
}
