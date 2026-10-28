import { exportRScript, type ScriptTarget } from '../../io';
import { useStore } from '../../store';

/** Download the R script for this analysis (shown when the R engine is selected). */
export function RScriptButton({ what }: { what: ScriptTarget }) {
  const engine = useStore((s) => s.settings.engine);
  if (engine !== 'r') return null;
  return (
    <button className="btn sm ghost" onClick={() => void exportRScript(what)} title="Download the R script that runs this analysis (data embedded), to reproduce it in R or RStudio.">
      R script
    </button>
  );
}

