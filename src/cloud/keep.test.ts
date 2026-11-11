import { beforeEach, describe, expect, it } from 'vitest';
import { listRecent, resetRecentForTests, saveRecent } from '../recent';
import { useStore } from '../store';
import { ApiError } from './api';
import { useAuth, type CloudUser } from './auth';
import { keepable, keepInAccount, resetKeepForTests, RETRY_MS } from './keep';

const user: CloudUser = {
  id: 'u1',
  email: 'a@b.c',
  display_name: 'A',
  totp_enabled: false,
  has_password: true,
  google_linked: false,
  email_verified: true,
};
const s = () => useStore.getState();
/** A share that behaves like shareCurrentProject: the project becomes a cloud project. */
const shared: string[] = [];
const share = async (u: CloudUser) => {
  shared.push(u.id);
  useStore.setState({
    projectId: 'cloud:p1',
    cloud: { projectId: 'p1', role: 'owner', status: 'connecting' },
  });
};

beforeEach(() => {
  s().newProject();
  useStore.setState({ toasts: [], cloud: null, example: null });
  useAuth.setState({ user: null });
  resetKeepForTests();
  resetRecentForTests();
  shared.length = 0;
});

describe('keeping projects in the account', () => {
  it('keeps nothing when signed out, or for an empty project, an example, or a project that is already in the cloud', async () => {
    s().addConstruct(0, 0, ['x1']);
    expect(await keepInAccount(share)).toBe(false);
    useAuth.setState({ user });
    s().newProject();
    expect(keepable()).toBe(false);
    s().addConstruct(0, 0, ['x1']);
    useStore.setState({ example: 'customer' });
    expect(keepable()).toBe(false);
    useStore.setState({ example: null, projectId: 'cloud:zz' });
    expect(keepable()).toBe(false);
    expect(shared).toEqual([]);
  });

  it('turns a local project with a model into a cloud project once, drops its local copy and says so', async () => {
    useAuth.setState({ user });
    s().addConstruct(0, 0, ['x1']);
    const local = s().projectId;
    await saveRecent({
      id: local,
      name: 'Mine',
      method: 'pls',
      updated: 1,
      constructs: 1,
      dataLabel: 'no data',
      text: '{}',
    });
    const [a, b] = await Promise.all([keepInAccount(share), keepInAccount(share)]); // concurrent calls share one attempt
    expect([a, b]).toEqual([true, true]);
    expect(shared).toEqual(['u1']);
    expect(s().projectId).toBe('cloud:p1');
    expect((await listRecent()).map((r) => r.id)).not.toContain(local);
    expect(s().toasts.at(-1)!.text).toContain('saved to your account');
    expect(await keepInAccount(share)).toBe(false); // already there
  });

  it('keeps the project when the person signs in with it open', async () => {
    s().setData(
      { names: ['a'], cols: [Float64Array.from([1, 2, 3])] },
      { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] },
    );
    expect(keepable()).toBe(false);
    useAuth.setState({ user });
    expect(keepable()).toBe(true); // (the subscription then calls keepInAccount with the real share)
  });

  it('stops for an account that may not create projects (unverified), and waits a minute after other failures', async () => {
    useAuth.setState({ user });
    s().addConstruct(0, 0, ['x1']);
    expect(
      await keepInAccount(async () => {
        throw new ApiError('Verify your email address first.', 403, 'unverified');
      }),
    ).toBe(false);
    expect(s().toasts.at(-1)!.text).toContain('Verify your email address first');
    expect(keepable()).toBe(false);
    resetKeepForTests();
    expect(
      await keepInAccount(async () => {
        throw new Error('offline');
      }),
    ).toBe(false);
    expect(keepable()).toBe(false);
    expect(keepable(Date.now() + RETRY_MS + 1)).toBe(true);
  });
});
