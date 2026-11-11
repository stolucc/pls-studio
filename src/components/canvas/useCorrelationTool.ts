// The correlation tool: pick two ends by clicking both or by dragging from one to the other; a context menu's
// "Correlate with…" switches to the tool with its first end picked.

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { correlationEndError, correlationPairError, type Method } from '../../model/project';
import { useStore, type Tool } from '../../store';
import { endAt } from '../correlationEnds';
import type { CorrelationPick } from '../CovarianceLayer';

/** The correlation tool's state (the first end picked, the rubber band while dragging) and its handlers. */
export function useCorrelationTool(tool: Tool, method: Method, readOnly: boolean) {
  const st = useStore.getState;
  // Correlation tool: the first end picked, waiting for the second.
  const [picked, setPicked] = useState<CorrelationPick | null>(null);
  // "Correlate with…" from a context menu switches to the tool with its first end picked.
  const pendingPick = useRef<CorrelationPick | null>(null);
  useEffect(() => {
    setPicked(pendingPick.current);
    pendingPick.current = null;
  }, [tool]);
  useEffect(() => {
    if (method !== 'cbsem' && tool === 'correlate') st().setTool('select');
  }, [method, tool, st]);
  /** Is this end allowed at all? Explains why not. */
  const endOk = useCallback(
    (p: CorrelationPick) => {
      const endError = correlationEndError(st().model, p);
      if (!endError) return true;
      st().toast('info', endError);
      if (!st().showErrorTerms) st().setShowErrorTerms(true);
      return false;
    },
    [st],
  );
  /** Correlate two ends (a correlation is estimated only when drawn). */
  const link = useCallback(
    (a: CorrelationPick, b: CorrelationPick) => {
      const pairError = correlationPairError(st().model, a, b);
      if (pairError) {
        st().toast('error', pairError);
        return;
      }
      st().addCorrelation(a.kind, a.id, b.id);
    },
    [st],
  );
  const pick = useCallback(
    (p: CorrelationPick) => {
      if (!endOk(p)) return;
      if (!picked) {
        setPicked(p);
        return;
      }
      if (picked.kind === p.kind && picked.id === p.id) {
        setPicked(null);
        return;
      }
      link(picked, p);
      setPicked(null);
    },
    [picked, endOk, link],
  );

  // Drawing a correlation by dragging from one end (construct, indicator error, disturbance) to another.
  const [rubber, setRubber] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );
  const onCorrelateDown = (e: React.PointerEvent) => {
    if (tool !== 'correlate' || readOnly || e.button !== 0) return;
    const start = endAt(e.target as Element);
    if (!start) return;
    // Keep React Flow from panning the canvas along with the pointer (clicks still reach the node).
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      setRubber({
        x1: x0 - box.left,
        y1: y0 - box.top,
        x2: ev.clientX - box.left,
        y2: ev.clientY - box.top,
      });
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
  const startCorrelate = (p: CorrelationPick) => {
    if (!endOk(p)) return;
    if (p.kind === 'indicator' && !st().showErrorTerms) st().setShowErrorTerms(true);
    if (tool === 'correlate') {
      setPicked(p);
      return;
    }
    pendingPick.current = p;
    st().setTool('correlate');
  };
  return { picked, setPicked, pick, rubber, onCorrelateDown, startCorrelate };
}
