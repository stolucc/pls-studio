import type { ScriptTarget } from '../../io';
import { useStore } from '../../store';

/** Download the R script for this analysis (shown when the R engine is selected). */
export function RScriptButton({ what }: { what: ScriptTarget }) {
  const engine = useStore((s) => s.settings.engine);
  const method = useStore((s) => s.settings.method);
  // Conditional process analysis always runs in R.
  if (engine !== 'r' && method !== 'process') return null;
  return (
    // (io.ts is loaded on click: it imports the analysis registry, which lists the cards that show these tabs)
    <button
      className="btn sm ghost"
      onClick={() => void import('../../io').then((m) => m.exportRScript(what))}
      title="Download the R script that runs this analysis (data embedded), to reproduce it in R or RStudio."
    >
      R script
    </button>
  );
}
