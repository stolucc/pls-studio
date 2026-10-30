// Warnings of every R call reach the session's Messages, whichever panel made
// the call (some panels show their own warnings only inline, or none). The
// store registers the sink; the bridge reports each result's warnings to it.

export type WarningSink = (warnings: string[], source: string) => void;

let sink: WarningSink | null = null;
export function setWarningSink(f: WarningSink | null) { sink = f; }

/** Report the warnings of an R result (its `warnings`, one string or a list). */
export function reportRWarnings(result: unknown, pkg: string) {
  if (!sink || !result || typeof result !== 'object') return;
  const r = result as { warnings?: unknown; engine?: { package?: unknown; version?: unknown } };
  const list = (Array.isArray(r.warnings) ? r.warnings : r.warnings == null ? [] : [r.warnings])
    .filter((w): w is string => typeof w === 'string' && w.trim() !== '');
  if (!list.length) return;
  const source = typeof r.engine?.package === 'string' ? `${r.engine.package}${typeof r.engine.version === 'string' ? ` ${r.engine.version}` : ''}` : pkg;
  sink(list, source);
}
