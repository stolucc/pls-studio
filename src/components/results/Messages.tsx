import { copyText } from '../../format';
import { useStore, type Message } from '../../store';
import { IconAlert, IconCopy } from '../icons';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Warnings and errors of this session, newest first: from the R packages, the built-in engine and refused actions. */
export function MessagesView() {
  const messages = useStore((s) => s.messages);
  const clear = useStore((s) => s.clearMessages);
  const toast = useStore((s) => s.toast);
  const copy = async () => {
    const text = messages.map((m) => `${new Date(m.at).toISOString()}\t${m.level}\t${m.source ?? ''}\t${m.text}`).join('\n');
    const ok = await copyText(text);
    toast(ok ? 'success' : 'error', ok ? 'Messages copied.' : 'Clipboard access was blocked.');
  };
  if (!messages.length) return <div className="empty-results">No warnings or errors in this session.</div>;
  return (
    <div>
      <div className="table-tools">
        <h3>Warnings and errors ({messages.length})</h3>
        <button className="btn sm ghost" onClick={() => void copy()} title="Copy all messages as tab-separated text"><IconCopy size={13} /> Copy</button>
        <button className="btn sm ghost" onClick={clear}>Clear</button>
      </div>
      <ul className="messages">
        {[...messages].reverse().map((m: Message) => (
          <li key={m.id} className={`message ${m.level}`}>
            <IconAlert size={14} />
            <span className="when">{time(m.at)}</span>
            {m.source && <span className="chip">{m.source}</span>}
            <span className="text">{m.text}</span>
          </li>
        ))}
      </ul>
      <div className="hint" style={{ marginTop: 8 }}>
        Warnings come from the estimation (for example lavaan’s convergence or admissibility checks) and apply to the run that produced them. They are kept until you clear them or close the app.
      </div>
    </div>
  );
}
