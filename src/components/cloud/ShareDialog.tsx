import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../cloud/api';
import { useAuth } from '../../cloud/auth';
import { closeSession, shareCurrentProject } from '../../cloud/collab';
import { useStore } from '../../store';
import { confirmDialog } from '../Overlays';
import { IconTrash, IconX } from '../icons';
import { Avatar } from './AccountMenu';
import { useEscape } from '../useEscape';

interface Member { id: string; email: string; display_name: string; role: 'owner' | 'editor' | 'viewer' }
interface Invitation { id: string; email: string; role: 'editor' | 'viewer'; expires_at: string }
export interface SentInvite { email: string; link: string; emailed: boolean }

/** After inviting: the link to pass on, and whether the server emailed it. */
export function InviteSent({ sent, onCopy }: { sent: SentInvite; onCopy: () => void }) {
  return (
    <div className={`issue ${sent.emailed ? 'info' : 'warning'} invite-sent`}>
      {sent.emailed
        ? <>Invitation emailed to <b>{sent.email}</b>. You can also send them this link:</>
        : <>No email was sent: this server has no email set up (or sending failed). Send <b>{sent.email}</b> this link yourself:</>}
      <div className="invite-link">
        <input className="input" readOnly value={sent.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn sm" onClick={onCopy}>Copy link</button>
      </div>
      <span className="sub">Only an account with {sent.email} can accept it. It works for 7 days.</span>
    </div>
  );
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const user = useAuth((s) => s.user);
  const openDialog = useAuth((s) => s.openDialog);
  const cloud = useStore((s) => s.cloud);
  const hasData = useStore((s) => s.data !== null);
  const toast = useStore((s) => s.toast);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentInvite | null>(null);
  const owner = cloud?.role === 'owner';

  const load = useCallback(async () => {
    if (!cloud) return;
    try {
      setMembers((await api.get<{ members: Member[] }>(`/api/projects/${cloud.projectId}/members`)).members);
      if (cloud.role === 'owner') setInvites((await api.get<{ invitations: Invitation[] }>(`/api/projects/${cloud.projectId}/invitations`)).invitations);
    } catch (e) { setError((e as Error).message); }
  }, [cloud]);
  useEffect(() => { void load(); }, [load]);
  useEscape(onClose);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setError(null);
    try { await fn(); if (ok) toast('success', ok); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const upload = () => {
    if (!user) { openDialog('signin', 'Sign in to share this project.'); return; }
    void act(() => shareCurrentProject(user), 'Project shared. Invite people below.');
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const to = email;
      const r = await api.post<{ link: string; emailed: boolean }>(`/api/projects/${cloud!.projectId}/invitations`, { email: to, role });
      setSent({ email: to, link: r.link, emailed: r.emailed });
      setEmail('');
    });
  };

  const leave = async () => {
    if (!cloud || !user) return;
    if (!(await confirmDialog({ title: 'Leave this project?', body: 'You will lose access until the owner invites you again.', confirmLabel: 'Leave', danger: true }))) return;
    await act(async () => {
      await api.del(`/api/projects/${cloud.projectId}/members/${user.id}`);
      closeSession();
      useStore.getState().setView('home');
      onClose();
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal share" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="share-head">
          <h3 id="share-title">Share project</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        {!cloud ? (
          <>
            <p>Sharing uploads this project to the PLS Studio server so that people you invite can open it and edit it with you in real time.</p>
            <ul className="hint share-points">
              <li>The model is stored on the server; {hasData ? 'the dataset is uploaded too and stored encrypted (AES-256-GCM).' : 'datasets you add later are stored encrypted.'}</li>
              <li>Only people you invite by email can open it; you choose whether they can edit or only view.</li>
              <li>Your local copy stays in Recent projects; the shared version is listed under Shared projects.</li>
            </ul>
            {error && <div className="issue error">{error}</div>}
            <div className="actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={upload} disabled={busy}>{user ? 'Upload and share' : 'Sign in to share'}</button>
            </div>
          </>
        ) : (
          <>
            {owner && (
              <form className="invite-row" onSubmit={invite}>
                <input className="input" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email to invite" />
                <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')} aria-label="Role">
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <button className="btn primary" disabled={busy}>Invite</button>
              </form>
            )}
            {error && <div className="issue error">{error}</div>}
            {owner && sent && <InviteSent sent={sent} onCopy={() => void navigator.clipboard.writeText(sent.link).then(() => toast('success', 'Link copied.'), () => toast('error', 'Could not copy; select the link and copy it.'))} />}
            <div className="section-title" style={{ marginTop: 12 }}>People with access</div>
            <div className="member-list">
              {members.map((m) => (
                <div className="member" key={m.id}>
                  <Avatar id={m.id} name={m.display_name} />
                  <span className="member-name">{m.display_name}{m.id === user?.id ? ' (you)' : ''}<br /><span className="sub">{m.email}</span></span>
                  {owner && m.role !== 'owner' ? (
                    <>
                      <select className="select" value={m.role} aria-label={`Role of ${m.display_name}`} onChange={(e) => void act(() => api.patch(`/api/projects/${cloud.projectId}/members/${m.id}`, { role: e.target.value }))}>
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                      <button className="btn icon ghost sm" aria-label={`Remove ${m.display_name}`} title="Remove access"
                        onClick={async () => { if (await confirmDialog({ title: `Remove ${m.display_name}?`, body: 'They lose access immediately, including any open session.', confirmLabel: 'Remove', danger: true })) void act(() => api.del(`/api/projects/${cloud.projectId}/members/${m.id}`)); }}>
                        <IconTrash size={13} />
                      </button>
                    </>
                  ) : <span className="chip">{m.role === 'owner' ? 'Owner' : m.role === 'editor' ? 'Can edit' : 'Can view'}</span>}
                </div>
              ))}
            </div>
            {owner && invites.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 12 }}>Pending invitations</div>
                <div className="member-list">
                  {invites.map((i) => (
                    <div className="member" key={i.id}>
                      <span className="avatar pending">?</span>
                      <span className="member-name">{i.email}<br /><span className="sub">{i.role === 'editor' ? 'Can edit' : 'Can view'} · expires {new Date(i.expires_at).toLocaleDateString()}</span></span>
                      <button className="btn sm" onClick={() => void act(() => api.del(`/api/projects/${cloud.projectId}/invitations/${i.id}`), 'Invitation withdrawn.')}>Withdraw</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!owner && <div className="actions" style={{ marginTop: 14 }}><button className="btn danger" onClick={() => void leave()}>Leave project</button></div>}
            <p className="hint" style={{ marginTop: 12 }}>Everyone with access edits the same model live. Each person runs calculations on their own computer; results are not shared automatically.</p>
          </>
        )}
      </div>
    </div>
  );
}
