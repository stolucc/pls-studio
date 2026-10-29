import type { Method } from '../model/project';
import { useR } from '../rengine/status';
import type { Results } from '../store';

/** Which software produced the results on screen (provenance for reporting). */
export function engineOf(results: Results | null, method: Method, twoSls: boolean): string | null {
  if (!results) return null;
  if (method === 'process') return results.process ? `${results.process.engine.package} ${results.process.engine.version}` : null;
  if (method === 'cbsem' && !twoSls && results.cb) {
    const e = (results.cb as { engine?: { package: string; version: string } }).engine;
    return e ? `${e.package} ${e.version}` : 'built-in engine';
  }
  if (method === 'pls' && results.pls) {
    const e = (results.pls as { engine?: { package: string; version: string } }).engine;
    return e ? `${e.package} ${e.version}` : 'built-in engine';
  }
  if (method === 'cbsem' && twoSls && results.miiv) {
    const e = (results.miiv as { engine?: { package: string; version: string } }).engine;
    return e ? `${e.package} ${e.version}` : 'built-in engine';
  }
  return null;
}

export function EngineBadge({ label }: { label: string | null }) {
  const versions = useR((s) => s.versions);
  if (!label) return null;
  const r = label !== 'built-in engine';
  return (
    <span className={`chip engine-chip${r ? ' accent' : ''}`} title={r ? `Calculated by the R package ${label} running in your browser (R ${versions.R ?? ''}, webR ${versions.webR ?? ''}). Cite the package when you report these results.` : 'Calculated by PLS Studio’s built-in engine (validated against the R reference packages).'}>
      {r ? `${label} · R ${versions.R ?? ''}` : 'Built-in engine'}
    </span>
  );
}
