// Warnings of every R call reach the session's Messages, whichever panel made
// the call (some panels show their own warnings only inline, or none). The
// store registers the sink; the bridge reports each result's warnings to it.

import { rList } from './rjson';

export type WarningSink = (warnings: string[], source: string, level?: 'warning' | 'info') => void;

let sink: WarningSink | null = null;
export function setWarningSink(f: WarningSink | null) {
  sink = f;
}

const strings = (v: unknown) =>
  rList<unknown>(v).filter((w): w is string => typeof w === 'string' && w.trim() !== '');

/** Report the warnings of an R result (its `warnings`, one string or a list) and its notes (`notes`, as information). */
export function reportRWarnings(result: unknown, pkg: string) {
  if (!sink || !result || typeof result !== 'object') return;
  const r = result as {
    warnings?: unknown;
    notes?: unknown;
    engine?: { package?: unknown; version?: unknown };
  };
  const warnings = strings(r.warnings);
  const notes = strings(r.notes);
  if (!warnings.length && !notes.length) return;
  const source =
    typeof r.engine?.package === 'string'
      ? `${r.engine.package}${typeof r.engine.version === 'string' ? ` ${r.engine.version}` : ''}`
      : pkg;
  if (warnings.length) sink(warnings, source, 'warning');
  if (notes.length) sink(notes, source, 'info');
}
