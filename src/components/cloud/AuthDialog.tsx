import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../cloud/auth';
import { useStore } from '../../store';
import { useEscape } from '../useEscape';

/** Sign in / create account / second factor / confirm Google link, all on-theme. */
export function AuthDialog() {
  const auth = useAuth();
  const d = auth.dialog;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [password2, setPassword2] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { setError(null); setNeedCode(false); setCode(''); setSent(null); setPassword2(''); setTimeout(() => first.current?.focus(), 0); }, [d?.mode]);
  useEscape(() => auth.closeDialog(), !!d);
  if (!d) return null;

  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const ae = err as { message: string; code?: string };
      if (ae.code === 'totp_required') setNeedCode(true);
      setError(ae.code === 'totp_required' ? null : ae.message);
    } finally {
      setBusy(false);
    }
  };

  const title = d.mode === 'register' ? 'Create an account' : d.mode === 'totp' ? 'Two-factor authentication' : d.mode === 'link' ? 'Link your Google account'
    : d.mode === 'forgot' ? 'Reset your password' : d.mode === 'reset' ? 'Choose a new password' : 'Sign in to PLS Studio';
  const register = async () => {
    await auth.register(email, password, name);
    useStore.getState().toast('info', `Check ${email} for a link to verify your address; sharing projects needs a verified email.`);
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => auth.closeDialog()}>
      <div className="modal auth" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="auth-title">{title}</h3>
        {d.message && <p className="hint" style={{ marginBottom: 10 }}>{d.message}</p>}

        {(d.mode === 'signin' || d.mode === 'register') && (
          <form onSubmit={(e) => run(e, () => (d.mode === 'register' ? register() : auth.signIn(email, password, needCode ? code : undefined)))}>
            {d.mode === 'register' && (
              <div className="field"><label htmlFor="a-name">Name</label><input id="a-name" ref={first} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} /></div>
            )}
            <div className="field"><label htmlFor="a-email">Email</label><input id="a-email" ref={d.mode === 'signin' ? first : undefined} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
            <div className="field"><label htmlFor="a-pw">Password</label><input id="a-pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={d.mode === 'register' ? 'new-password' : 'current-password'} required minLength={d.mode === 'register' ? 12 : 1} />
              {d.mode === 'register' && <span className="hint">At least 12 characters.</span>}</div>
            {needCode && (
              <div className="field"><label htmlFor="a-code">Authentication code</label><input id="a-code" className="input num" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus required /></div>
            )}
            {error && <div className="issue error">{error}</div>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => auth.closeDialog()}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy}>{d.mode === 'register' ? 'Create account' : 'Sign in'}</button>
            </div>
            {auth.googleEnabled && (
              <>
                <div className="auth-or"><span>or</span></div>
                <a className="btn google" href="/api/auth/google/start">Continue with Google</a>
              </>
            )}
            <p className="hint auth-switch">
              {d.mode === 'register'
                ? <>Already have an account? <button type="button" className="linkish" onClick={() => auth.openDialog('signin', d.message)}>Sign in</button></>
                : <>New here? <button type="button" className="linkish" onClick={() => auth.openDialog('register', d.message)}>Create an account</button> · <button type="button" className="linkish" onClick={() => auth.openDialog('forgot')}>Forgot your password?</button></>}
            </p>
          </form>
        )}

        {d.mode === 'forgot' && (
          <form onSubmit={(e) => run(e, async () => { await auth.forgotPassword(email); setSent(email); })}>
            {sent ? (
              <p>If an account exists for <b>{sent}</b>, an email with a link to choose a new password is on its way. The link works for one hour.</p>
            ) : (
              <>
                <p>Enter your email address; we send you a link to choose a new password. This also works for accounts that sign in with Google and want a password.</p>
                <div className="field"><label htmlFor="f-email">Email</label><input id="f-email" ref={first} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
              </>
            )}
            {error && <div className="issue error">{error}</div>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => auth.openDialog('signin')}>Back to sign in</button>
              {!sent && <button type="submit" className="btn primary" disabled={busy}>Send the link</button>}
            </div>
          </form>
        )}

        {d.mode === 'reset' && (
          <form onSubmit={(e) => run(e, async () => {
            if (password !== password2) throw new Error('The two passwords differ.');
            await auth.resetPassword(d.token ?? '', password);
          })}>
            <div className="field"><label htmlFor="r-pw">New password</label><input id="r-pw" ref={first} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={12} /><span className="hint">At least 12 characters.</span></div>
            <div className="field"><label htmlFor="r-pw2">Repeat it</label><input id="r-pw2" className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required minLength={12} /></div>
            {error && <div className="issue error">{error}</div>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => auth.closeDialog()}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy}>Set password</button>
            </div>
          </form>
        )}

        {d.mode === 'totp' && (
          <form onSubmit={(e) => run(e, () => auth.verifyTotp(code))}>
            <p>Enter the 6-digit code from your authenticator app.</p>
            <div className="field"><input ref={first} className="input num" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required aria-label="Authentication code" /></div>
            {error && <div className="issue error">{error}</div>}
            <div className="actions"><button type="submit" className="btn primary" disabled={busy}>Verify</button></div>
          </form>
        )}

        {d.mode === 'link' && (
          <form onSubmit={(e) => run(e, () => auth.linkGoogle(password, needCode ? code : undefined))}>
            <p>An account for {auth.pendingGoogleLink?.email} already exists. Enter its password once to link Google sign-in to it.</p>
            <div className="field"><label htmlFor="l-pw">Password</label><input id="l-pw" ref={first} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
            {needCode && <div className="field"><label htmlFor="l-code">Authentication code</label><input id="l-code" className="input num" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required /></div>}
            {error && <div className="issue error">{error}</div>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => auth.closeDialog()}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy}>Link and sign in</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
