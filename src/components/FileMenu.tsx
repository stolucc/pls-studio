import { openReplication } from './analyses/ReplicationDialog';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { exportCovarianceCsv, exportMplus, exportRScript, importAmos, importCsv, importModelSyntax, newProject, openProject, saveProject } from '../io';
import { useStore } from '../store';
import { IconChevronDown } from './icons';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** New, open, save, import and inspect data, R script: one menu. */
export function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasData = useStore((s) => s.data !== null);
  const rawCb = useStore((s) => !!s.data && !(s.data.moments && s.data.cols.length === 0) && s.settings.method === 'cbsem');
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key); };
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const item = (label: string, action: () => void, opts: { kbd?: string; disabled?: boolean } = {}) => (
    <button role="menuitem" className="menu-item" disabled={opts.disabled} onClick={() => { setOpen(false); action(); }}>
      {label}{opts.kbd && <span className="kbd">{opts.kbd}</span>}
    </button>
  );
  return (
    <div className="menu file-menu" ref={ref} onKeyDown={onKeyDown}>
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>File <IconChevronDown size={13} /></button>
      {open && (
        <div className="menu-pop" role="menu" aria-label="File">
          {item('New project', () => void newProject())}
          {item('Open project…', () => void openProject(), { kbd: `${mod}O` })}
          {item('Save project', saveProject, { kbd: `${mod}S` })}
          <div className="menu-sep" role="separator" />
          {item(hasData ? 'Replace data…' : 'Import data…', () => void importCsv())}
          {item('Inspect data', () => useStore.getState().setWorkspace('data'), { disabled: !hasData })}
          {item('Create replication package…', () => openReplication())}
          <div className="menu-sep" role="separator" />
          {item('Import model syntax (lavaan, Mplus)…', () => void importModelSyntax())}
          {item('Import AMOS model (.amw)…', () => void importAmos())}
          {item('Download R script', () => void exportRScript(), { disabled: !hasData })}
          {rawCb && item('Download covariance matrix (CSV)', () => exportCovarianceCsv())}
          {item('Download Mplus input', () => void exportMplus())}
          <div className="menu-sep" />
          <a role="menuitem" className="menu-item" href="guide.html" target="_blank" rel="noopener">User guide</a>
        </div>
      )}
    </div>
  );
}
