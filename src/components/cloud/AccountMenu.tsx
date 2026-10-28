import { useEffect, useRef, useState } from 'react';
import { api } from '../../cloud/api';
import { useAuth } from '../../cloud/auth';
import { colorFor } from '../../cloud/collab';
import { useStore } from '../../store';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function Avatar({ id, name, size = 26 }: { id: string; name: string; size?: number }) {
  return <span className="avatar" title={name} style={{ background: colorFor(id), width: size, height: size, fontSize: size * 0.42 }}>{initials(name)}</span>;
}

function TotpSetup({ onClose }: { onClose: () => void }) {
  const refresh = useAuth((s) => s.refresh);
  const user = useAuth((s) => s.user)!;
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!user.totp_enabled) api.post<{ qr: string; secret: string }>('/api/auth/totp/setup').then(setSetup).catch((e) => setError(e.message));
  }, [user.totp_enabled]);
  const submit = async () => {
    setError(null);
    try {
      if (user.totp_enabled) await api.post('/api/auth/totp/disable', { password });
      else await api.post('/api/auth/totp/enable', { code });
      await refresh();
      useStore.getState().toast('success', user.totp_enabled ? 'Two-factor authentication turned off.' : 'Two-factor authentication is on.');
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Two-factor authentication" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Two-factor authentication</h3>
        {user.totp_enabled ? (
          <>
            <p>Two-factor authentication is on. Enter your password to turn it off.</p>
            <div className="field"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" autoComplete="current-password" /></div>
          </>
        ) : (
          <>
            <p>Scan the QR code with an authenticator app (or enter the key), then type the 6-digit code it shows.</p>
            {setup && (
              <div style={{ display: 'grid', justifyItems: 'center', gap: 6, marginBottom: 10 }}>
                <img src={setup.qr} width={180} height={180} alt="QR code for your authenticator app" />
                <code className="num" style={{ fontSize: 11, wordBreak: 'break-all' }}>{setup.secret}</code>
              </div>
            )}
            <div className="field"><input className="input num" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Authentication code" autoComplete="one-time-code" /></div>
          </>
        )}
        {error && <div className="issue error">{error}</div>}
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => void submit()}>{user.totp_enabled ? 'Turn off' : 'Turn on'}</button>
        </div>
      </div>
    </div>
  );
}

/** Sign-in button, or the signed-in user's menu. Hidden when no server is reachable. */
export function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [totp, setTotp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!auth.available) return null;
  if (!auth.user) return <button className="btn" onClick={() => auth.openDialog('signin')}>Sign in</button>;
  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost account-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar id={auth.user.id} name={auth.user.display_name} /> <span className="account-name">{auth.user.display_name}</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-item" style={{ cursor: 'default' }}><span><b>{auth.user.display_name}</b><br /><span className="sub">{auth.user.email}</span></span></div>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); setTotp(true); }}>
            Two-factor authentication <span className="sub">{auth.user.totp_enabled ? 'on' : 'off'}</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); void auth.signOut(); }}>Sign out</button>
        </div>
      )}
      {totp && <TotpSetup onClose={() => setTotp(false)} />}
    </div>
  );
}
