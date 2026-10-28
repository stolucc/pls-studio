import { ViewportPortal } from '@xyflow/react';
import { usePresence } from '../../cloud/collab';
import { useStore } from '../../store';
import { Avatar } from './AccountMenu';

/** Collaborators' cursors and selections, drawn in flow coordinates. */
export function PresenceLayer() {
  const peers = usePresence((s) => s.peers);
  const constructs = useStore((s) => s.model.constructs);
  if (peers.length === 0) return null;
  const byId = new Map(constructs.map((c) => [c.id, c]));
  return (
    <ViewportPortal>
      {peers.map((p) => (
        <div key={p.clientId}>
          {p.selection.map((id) => {
            const c = byId.get(id);
            return c ? <div key={id} className="peer-select" style={{ transform: `translate(${c.x}px, ${c.y - 58}px) translateX(-50%)`, background: p.color }}>{p.name}</div> : null;
          })}
          {p.cursor && (
            <div className="peer-cursor" style={{ transform: `translate(${p.cursor.x}px, ${p.cursor.y}px)` }}>
              <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M1 1l13 7-6 2-2 7z" fill={p.color} stroke="white" strokeWidth="1.2" /></svg>
              <span style={{ background: p.color }}>{p.name}</span>
            </div>
          )}
        </div>
      ))}
    </ViewportPortal>
  );
}

/** Who is here + connection state, for the top bar. */
export function PresenceBar() {
  const cloud = useStore((s) => s.cloud);
  const peers = usePresence((s) => s.peers);
  if (!cloud) return null;
  const unique = [...new Map(peers.map((p) => [p.userId, p])).values()];
  const label = cloud.status === 'online' ? 'Live' : cloud.status === 'connecting' ? 'Connecting…' : 'Offline: changes sync when you reconnect';
  return (
    <div className="presence-bar" title={label}>
      <span className={`conn-dot ${cloud.status}`} aria-label={label} />
      {unique.slice(0, 5).map((p) => <Avatar key={p.userId} id={p.userId} name={`${p.name} (here now)`} size={24} />)}
      {unique.length > 5 && <span className="chip">+{unique.length - 5}</span>}
      {cloud.role === 'viewer' && <span className="chip">View only</span>}
    </div>
  );
}
