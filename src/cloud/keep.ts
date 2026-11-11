// A signed-in person's projects live in their account. The first autosave of
// a local project that has something in it (a model or data; not an example)
// turns it into a cloud project (shareCurrentProject: created on the server,
// the dataset uploaded encrypted, a live session that syncs every change), so
// it is on the home screen of every computer they sign in on. Signing in with
// such a project open keeps it at once.

import { removeRecent } from '../recent';
import { useStore } from '../store';
import { ApiError } from './api';
import { useAuth, type CloudUser } from './auth';

/** How long to wait after a failure (offline, server error) before trying again. */
export const RETRY_MS = 60_000;

let inFlight: Promise<boolean> | null = null;
/** The user whose account refused (unverified): no more attempts for them this session. */
let blockedFor: string | null = null;
let lastFailure = 0;

/** Whether the open project is one to keep now. */
export function keepable(now = Date.now()): boolean {
  const s = useStore.getState();
  const user = useAuth.getState().user;
  if (!user || user.id === blockedFor || now - lastFailure < RETRY_MS) return false;
  if (s.cloud || s.projectId.startsWith('cloud:') || s.example) return false;
  return s.model.constructs.length > 0 || s.data !== null;
}

const defaultShare = async (user: CloudUser) => {
  await (await import('./collab')).shareCurrentProject(user);
};

/** Keep the open project in the account (once; concurrent calls share one attempt). Resolves whether it was kept now. */
export function keepInAccount(
  share: (user: CloudUser) => Promise<void> = defaultShare,
): Promise<boolean> {
  if (inFlight) return inFlight;
  if (!keepable()) return Promise.resolve(false);
  const s = useStore.getState();
  const user = useAuth.getState().user!;
  const localId = s.projectId,
    name = s.projectName;
  inFlight = (async () => {
    try {
      await share(user);
      // The local copy is superseded (a cloud project keeps no copy in the browser: its data are encrypted on the server).
      await removeRecent(localId);
      useStore
        .getState()
        .toast(
          'success',
          `“${name}” is saved to your account: it is on your home screen and syncs as you work.`,
        );
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        blockedFor = user.id;
        useStore
          .getState()
          .toast('info', `${e.message} Until then this project is kept in this browser only.`);
      } else {
        lastFailure = Date.now();
      }
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function resetKeepForTests() {
  inFlight = null;
  blockedFor = null;
  lastFailure = 0;
}

// Signing in keeps the project that is open; every later change goes through autosave (io.ts).
useAuth.subscribe((s, prev) => {
  if (s.user && !prev.user) void keepInAccount();
});
