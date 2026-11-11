import { create } from 'zustand';
import { api, ApiError, setCsrf } from './api';

export interface CloudUser {
  id: string;
  email: string;
  display_name: string;
  totp_enabled: boolean;
  has_password: boolean;
  google_linked: boolean;
  email_verified: boolean;
}

interface SessionInfo {
  user: CloudUser | null;
  csrfToken: string;
  googleEnabled: boolean;
  pendingTotp: boolean;
  pendingGoogleLink: { email: string } | null;
}

interface AuthState {
  /** null: not checked yet; false: server unreachable (offline/local-only use). */
  available: boolean | null;
  user: CloudUser | null;
  googleEnabled: boolean;
  pendingTotp: boolean;
  pendingGoogleLink: { email: string } | null;
  /** Open the sign-in dialog, optionally with a message (e.g. "Sign in to accept the invitation"); `token` for a password-reset link. */
  dialog: { mode: DialogMode; message?: string; token?: string } | null;
  refresh: () => Promise<void>;
  openDialog: (mode?: DialogMode, message?: string, token?: string) => void;
  closeDialog: () => void;
  signIn: (email: string, password: string, code?: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  linkGoogle: (password: string, code?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Email a password-reset (or set-password) link; the server never says whether the address has an account. */
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  changePassword: (current: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<string>;
  resendVerification: () => Promise<void>;
}

export type DialogMode = 'signin' | 'register' | 'totp' | 'link' | 'forgot' | 'reset';

export const useAuth = create<AuthState>((set, get) => ({
  available: null,
  user: null,
  googleEnabled: false,
  pendingTotp: false,
  pendingGoogleLink: null,
  dialog: null,
  async refresh() {
    try {
      const s = await api.get<SessionInfo>('/api/auth/session');
      setCsrf(s.csrfToken);
      set({
        available: true,
        user: s.user,
        googleEnabled: s.googleEnabled,
        pendingTotp: s.pendingTotp,
        pendingGoogleLink: s.pendingGoogleLink,
        dialog: s.pendingTotp
          ? { mode: 'totp' }
          : s.pendingGoogleLink
            ? { mode: 'link' }
            : get().dialog,
      });
    } catch (err) {
      set({
        available: err instanceof ApiError && err.status !== 0 && err.status !== 404 ? true : false,
        user: null,
      });
    }
  },
  openDialog: (mode = 'signin', message, token) =>
    set({ dialog: { mode, message, ...(token ? { token } : {}) } }),
  closeDialog: () => set({ dialog: null }),
  async signIn(email, password, code) {
    const r = await api.post<{ user: CloudUser }>('/api/auth/login', {
      email,
      password,
      ...(code ? { code } : {}),
    });
    set({ user: r.user, dialog: null });
    await get().refresh();
  },
  async register(email, password, name) {
    const r = await api.post<{ user: CloudUser }>('/api/auth/register', { email, password, name });
    set({ user: r.user, dialog: null });
    await get().refresh();
  },
  async verifyTotp(code) {
    const r = await api.post<{ user: CloudUser }>('/api/auth/totp/verify', { code });
    set({ user: r.user, pendingTotp: false, dialog: null });
    await get().refresh();
  },
  async linkGoogle(password, code) {
    const r = await api.post<{ user: CloudUser }>('/api/auth/google/link', {
      password,
      ...(code ? { code } : {}),
    });
    set({ user: r.user, pendingGoogleLink: null, dialog: null });
    await get().refresh();
  },
  async signOut() {
    await api.post('/api/auth/logout');
    set({ user: null });
    await get().refresh();
  },
  async forgotPassword(email) {
    await api.post('/api/auth/password/forgot', { email });
  },
  async resetPassword(token, password) {
    await api.post('/api/auth/password/reset', { token, password });
    set({ dialog: { mode: 'signin', message: 'Your password is set. Sign in with it.' } });
  },
  async changePassword(current, password) {
    await api.post('/api/auth/password/change', { current, password });
  },
  async verifyEmail(token) {
    const r = await api.post<{ email: string }>('/api/auth/verify-email', { token });
    await get().refresh();
    return r.email;
  },
  async resendVerification() {
    await api.post('/api/auth/verify-email/resend');
  },
}));
