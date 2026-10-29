// Which correlation end an element belongs to: an error term or disturbance
// circle (data-cor-*), an indicator box (data-ind), or a construct node.

import { impliedCorrelations, type CorrelationEnd, type ModelState } from '../model/project';

export function endAt(el: Element | null): CorrelationEnd | null {
  const err = el?.closest('[data-cor-kind]');
  if (err) {
    const kind = err.getAttribute('data-cor-kind') === 'indicator' ? 'indicator' : 'construct';
    return { kind, id: err.getAttribute('data-cor-id') ?? '', ...(err.getAttribute('data-cor-via') === 'disturbance' ? { via: 'disturbance' as const } : {}) };
  }
  const ind = el?.closest('[data-ind]')?.getAttribute('data-ind');
  if (ind) return { kind: 'indicator', id: ind };
  const node = el?.closest('.react-flow__node')?.getAttribute('data-id');
  return node ? { kind: 'construct', id: node } : null;
}

/** Do two constructs already covary by default (two exogenous constructs, not yet drawn)? */
export function covaryByDefault(model: ModelState, a: CorrelationEnd, b: CorrelationEnd): boolean {
  if (a.kind !== 'construct' || b.kind !== 'construct' || a.via || b.via) return false;
  return impliedCorrelations(model).some((k) => (k.a === a.id && k.b === b.id) || (k.a === b.id && k.b === a.id));
}
