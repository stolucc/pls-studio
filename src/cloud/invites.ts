import { api } from './api';
import { useAuth } from './auth';
import { openCloudProject } from './collab';
import { useStore } from '../store';

let pendingInvite: string | null = null;

/** Handle ?invite=… and ?auth=… after load (and after signing in). */
export async function handleUrlParams() {
  const url = new URL(location.href);
  const invite = url.searchParams.get('invite');
  const auth = url.searchParams.get('auth');
  const verify = url.searchParams.get('verify');
  const reset = url.searchParams.get('reset');
  if (invite || auth || verify || reset) {
    for (const k of ['invite', 'auth', 'verify', 'reset']) url.searchParams.delete(k);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  const toast = useStore.getState().toast;
  if (verify) {
    try { toast('success', `${await useAuth.getState().verifyEmail(verify)} is verified. You can share projects and accept invitations.`); }
    catch (e) { toast('error', (e as Error).message); }
  }
  if (reset) useAuth.getState().openDialog('reset', undefined, reset);
  if (auth === 'google-failed') toast('error', 'Google sign-in did not complete. Please try again.');
  if (auth === 'google-unverified') toast('error', 'Your Google account’s email address is not verified.');
  if (invite) pendingInvite = invite;
  await acceptPendingInvite();
}

export async function acceptPendingInvite() {
  if (!pendingInvite) return;
  const token = pendingInvite;
  const { user, openDialog } = useAuth.getState();
  const toast = useStore.getState().toast;
  let preview: { projectName: string; inviterName: string; role: string; email: string };
  try {
    preview = await api.get(`/api/auth/invitations/${encodeURIComponent(token)}`);
  } catch (e) {
    pendingInvite = null;
    toast('error', (e as Error).message);
    return;
  }
  if (!user) {
    openDialog('signin', `${preview.inviterName} invited you to “${preview.projectName}”. Sign in or create an account with ${preview.email} to join.`);
    return;
  }
  try {
    const { projectId } = await api.post<{ projectId: string }>(`/api/auth/invitations/${encodeURIComponent(token)}/accept`);
    pendingInvite = null;
    await openCloudProject(projectId, user);
    toast('success', `You joined “${preview.projectName}”.`);
  } catch (e) {
    pendingInvite = null;
    toast('error', (e as Error).message);
  }
}

// Signing in (e.g. from the invitation prompt) continues a pending acceptance.
useAuth.subscribe((s, prev) => {
  if (s.user && !prev.user && pendingInvite) void acceptPendingInvite();
});
