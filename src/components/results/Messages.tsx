import { copyText } from '../../format';
import { useStore, type Message } from '../../store';
import { IconAlert, IconCheck, IconCopy, IconInfo } from '../icons';
import { expectedWhy } from '../../examples/expectedMessages';
import { exampleExpectedMessages } from '../ExampleBanner';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Warnings and errors of this session, newest first: from the R packages, the built-in engine and refused actions.
 * While an example is open, the warnings and notes it is expected to raise (PackageExample.expectedMessages) are
 * marked as expected, with the reason, instead of as problems.
 */
export function MessagesView() {
  const messages = useStore((s) => s.messages);
  const clear = useStore((s) => s.clearMessages);
  const toast = useStore((s) => s.toast);
  const expected = exampleExpectedMessages(useStore((s) => s.example));
  const copy = async () => {
    const text = messages.map((m) => `${new Date(m.at).toISOString()}\t${m.level}\t${m.source ?? ''}\t${m.text}`).join('\n');
    const ok = await copyText(text);
    toast(ok ? 'success' : 'error', ok ? 'Messages copied.' : 'Clipboard access was blocked.');
  };
  if (!messages.length) return <div className="empty-results">No messages in this session.</div>;
  return (
    <div>
      <div className="table-tools">
        <h3>Messages ({messages.length})</h3>
        <button className="btn sm ghost" onClick={() => void copy()} title="Copy all messages as tab-separated text"><IconCopy size={13} /> Copy</button>
        <button className="btn sm ghost" onClick={clear}>Clear</button>
      </div>
      <ul className="messages">
        {[...messages].reverse().map((m: Message) => {
          // (an error is never expected)
          const why = m.level === 'error' ? null : expectedWhy(expected, m.text, m.level);
          return (
            <li key={m.id} className={`message ${m.level}${why ? ' expected' : ''}`}>
              {why ? <IconCheck size={14} /> : m.level === 'info' ? <IconInfo size={14} /> : <IconAlert size={14} />}
              <span className="when">{time(m.at)}</span>
              {m.source && <span className="chip">{m.source}</span>}
              {why && <span className="chip expected" title={why}>Expected in this example</span>}
              <span className="text">{m.text}{why && <span className="why">Why: {why}</span>}</span>
            </li>
          );
        })}
      </ul>
      <div className="hint" style={{ marginTop: 8 }}>
        Warnings come from the estimation (for example lavaan’s convergence or admissibility checks) and apply to the run that produced them; notes explain a result (a value that cannot be computed, a convention) and flag nothing. They are kept until you clear them or close the app.{expected?.length ? ' While this example is open, a message it is documented to raise is marked “Expected in this example”, with the reason.' : ''}
      </div>
    </div>
  );
}
