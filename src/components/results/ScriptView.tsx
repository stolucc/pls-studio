import { useEffect, useState } from 'react';
import { downloadText } from '../../format';
import { buildRScript } from '../../io';
import { useStore } from '../../store';
import { IconCopy } from '../icons';

/** The script's parts: header, embedded data (long), calculation and report. */
export function splitScript(text: string): { head: string[]; data: string[]; rest: string[] } {
  const lines = text.split('\n');
  const d = lines.findIndex((l) => l.startsWith('# ---- Data used'));
  const c = lines.findIndex((l) => l.startsWith('# ---- Calculation'));
  if (d < 0 || c < d) return { head: [], data: [], rest: lines };
  return { head: lines.slice(0, d + 1), data: lines.slice(d + 1, c), rest: lines.slice(c) };
}

function Lines({ lines, from }: { lines: string[]; from: number }) {
  return (
    <pre className="r-script">
      {lines.map((l, i) => (
        <div key={i} className={l.trimStart().startsWith('#') ? 'cm' : undefined}><span className="ln">{from + i}</span>{l || ' '}</div>
      ))}
    </pre>
  );
}

/**
 * The R script behind the current model: what the R engine runs, generated
 * for the model and settings as they are now, to read, copy or download.
 */
export function ScriptView() {
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const dataVersion = useStore((s) => s.dataVersion);
  const [state, setState] = useState<{ text: string; file: string; pkg: string } | { error: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    setState(null);
    const t = setTimeout(() => {
      buildRScript('model').then((r) => { if (live) setState(r); }, (e: Error) => { if (live) setState({ error: e.message }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [model, settings, dataVersion]);

  if (!state) return <div className="empty-results">Writing the R script…</div>;
  if ('error' in state) return <div className="empty-results">No R script yet: {state.error}</div>;
  const { head, data, rest } = splitScript(state.text);
  const copy = async () => {
    try { await navigator.clipboard.writeText(state.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { useStore.getState().toast('error', 'The browser did not allow copying; use Download instead.'); }
  };
  return (
    <div className="script-view">
      <div className="table-tools">
        <h3>R script ({state.pkg})</h3>
        <span className="hint">Exactly what runs for this model and these settings; it updates as you edit.</span>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => void copy()}><IconCopy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
        <button className="btn sm ghost" onClick={() => downloadText(state.file, state.text, 'text/x-r-source')}>Download</button>
      </div>
      <Lines lines={head} from={1} />
      {data.length > 0 && (
        <details className="r-script-data">
          <summary>Embedded data ({data.length} lines)</summary>
          <Lines lines={data} from={head.length + 1} />
        </details>
      )}
      <Lines lines={rest} from={head.length + data.length + 1} />
    </div>
  );
}
