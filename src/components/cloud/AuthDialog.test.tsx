// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth, type CloudUser } from '../../cloud/auth';
import { AccountMenu } from './AccountMenu';
import { AuthDialog } from './AuthDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Client render with the store's current state (server rendering would read zustand's initial state). */
function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return {
    host,
    html: () => host.innerHTML,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
const render = (el: React.ReactElement) => {
  const m = mount(el);
  const html = m.html();
  m.unmount();
  return html;
};

const user: CloudUser = {
  id: 'u1',
  email: 'ann@example.org',
  display_name: 'Ann',
  totp_enabled: false,
  has_password: true,
  google_linked: false,
  email_verified: false,
};

beforeEach(() =>
  useAuth.setState({ available: true, user: null, dialog: null, googleEnabled: false }),
);

describe('password reset in the sign-in dialog', () => {
  it('offers the forgotten-password link when signing in', () => {
    useAuth.setState({ dialog: { mode: 'signin' } });
    expect(render(<AuthDialog />)).toContain('Forgot your password?');
  });

  it('asks for the email, and says the link also sets a password for Google accounts', () => {
    useAuth.setState({ dialog: { mode: 'forgot' } });
    const html = render(<AuthDialog />);
    expect(html).toContain('Reset your password');
    expect(html).toContain('id="f-email"');
    expect(html).toContain('sign in with Google and want a password');
  });

  it('asks for the new password twice when opened from an emailed link', () => {
    useAuth.setState({ dialog: { mode: 'reset', token: 'abc' } });
    const html = render(<AuthDialog />);
    expect(html).toContain('Choose a new password');
    expect(html).toContain('id="r-pw"');
    expect(html).toContain('id="r-pw2"');
    expect(html).toContain('minlength="12"');
  });
});

describe('account menu', () => {
  const open = () => {
    const m = mount(<AccountMenu />);
    act(() => m.host.querySelector<HTMLButtonElement>('.account-btn')!.click());
    const html = m.html();
    m.unmount();
    return html;
  };

  it('shows an unverified address with a way to resend the email, and a change-password item', () => {
    useAuth.setState({ user });
    const html = open();
    expect(html).toContain('Email not verified');
    expect(html).toContain('send the link again');
    expect(html).toContain('Change password');
  });

  it('offers to set a password for a Google-only account, and no verification item once verified', () => {
    useAuth.setState({
      user: { ...user, has_password: false, google_linked: true, email_verified: true },
    });
    const html = open();
    expect(html).toContain('Set a password');
    expect(html).not.toContain('Email not verified');
  });
});
