import type { Method } from '../model/project';
import { useR } from '../rengine/status';
import type { Results } from '../store';

type Engine = { package: string; version: string; desktop?: string };
const label = (e: Engine) =>
  `${e.package} ${e.version}${e.desktop ? ` · desktop ${e.desktop.replace(/^R version ([0-9.]+).*/, 'R $1')}` : ''}`;

/** Which software produced the results on screen (provenance for reporting). */
export function engineOf(results: Results | null, method: Method, twoSls: boolean): string | null {
  if (!results) return null;
  if (method === 'process') return results.process ? label(results.process.engine as Engine) : null;
  if (method === 'cbsem' && !twoSls && results.cb) {
    const e = (results.cb as { engine?: Engine }).engine;
    return e ? label(e) : 'built-in engine';
  }
  if (method === 'pls' && results.pls) {
    const e = (results.pls as { engine?: Engine }).engine;
    return e ? label(e) : 'built-in engine';
  }
  if (method === 'cbsem' && twoSls && results.miiv) {
    const e = (results.miiv as { engine?: Engine }).engine;
    return e ? label(e) : 'built-in engine';
  }
  return null;
}

export function EngineBadge({ label }: { label: string | null }) {
  const versions = useR((s) => s.versions);
  if (!label) return null;
  const r = label !== 'built-in engine';
  const desktop = label.includes(' · desktop ');
  return (
    <span
      className={`chip engine-chip${r ? ' accent' : ''}`}
      title={
        r
          ? desktop
            ? `Calculated by the R package ${label.replace(' · desktop', ' in desktop')} (through the PLS Studio helper). Cite the package when you report these results.`
            : `Calculated by the R package ${label} running in your browser (R ${versions.R ?? ''}, webR ${versions.webR ?? ''}). Cite the package when you report these results.`
          : 'Calculated by PLS Studio’s built-in engine (validated against the R reference packages).'
      }
    >
      {r ? (desktop ? label : `${label} · R ${versions.R ?? ''}`) : 'Built-in engine'}
    </span>
  );
}
