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

function PasswordChange({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const user = auth.user!;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async () => {
    setError(null);
    try {
      if (!user.has_password) { await auth.forgotPassword(user.email); setSent(true); return; }
      if (next !== next2) throw new Error('The two new passwords differ.');
      await auth.changePassword(current, next);
      useStore.getState().toast('success', 'Password changed. Other devices were signed out.');
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={user.has_password ? 'Change password' : 'Set a password'} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{user.has_password ? 'Change password' : 'Set a password'}</h3>
        {!user.has_password ? (
          sent ? <p>An email with a link to set your password is on its way to {user.email}. The link works for one hour.</p>
            : <p>This account signs in with Google. To add a password as well, we email you a link to set one.</p>
        ) : (
          <>
            <div className="field"><label htmlFor="pc-cur">Current password</label><input id="pc-cur" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></div>
            <div className="field"><label htmlFor="pc-new">New password</label><input id="pc-new" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} /><span className="hint">At least 12 characters.</span></div>
            <div className="field"><label htmlFor="pc-new2">Repeat it</label><input id="pc-new2" className="input" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" minLength={12} /></div>
          </>
        )}
        {error && <div className="issue error">{error}</div>}
        <div className="actions">
          <button className="btn" onClick={onClose}>{sent ? 'Close' : 'Cancel'}</button>
          {!sent && <button className="btn primary" onClick={() => void submit()}>{user.has_password ? 'Change' : 'Email me the link'}</button>}
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
  const [pw, setPw] = useState(false);
  const toast = useStore((s) => s.toast);
  const resend = async () => {
    try { await auth.resendVerification(); toast('success', `Verification email sent to ${auth.user!.email}.`); }
    catch (e) { toast('error', (e as Error).message); }
  };
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
          {!auth.user.email_verified && (
            <button className="menu-item unverified" role="menuitem" onClick={() => { setOpen(false); void resend(); }}>
              Email not verified <span className="sub">send the link again</span>
            </button>
          )}
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); setPw(true); }}>
            {auth.user.has_password ? 'Change password' : 'Set a password'}
          </button>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); setTotp(true); }}>
            Two-factor authentication <span className="sub">{auth.user.totp_enabled ? 'on' : 'off'}</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); void auth.signOut(); }}>Sign out</button>
        </div>
      )}
      {totp && <TotpSetup onClose={() => setTotp(false)} />}
      {pw && <PasswordChange onClose={() => setPw(false)} />}
    </div>
  );
}
