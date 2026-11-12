// Opening a home-screen example whose dataset comes from an R package reads the copy bundled with the app
// (examples/bundledData.ts) without starting R; R reads the package only when there is no copy or it cannot be loaded.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const rCall = vi.fn();
vi.mock('./rengine/bridge', async (orig) => ({
  ...(await orig<typeof import('./rengine/bridge')>()),
  rCall: (...a: unknown[]) => rCall(...a),
}));
let withoutCopy = false;
vi.mock('./examples/bundledData', async (orig) => {
  const actual = await orig<typeof import('./examples/bundledData')>();
  return {
    ...actual,
    bundledDataFile: (d: Parameters<typeof actual.bundledDataFile>[0]) =>
      withoutCopy ? null : actual.bundledDataFile(d),
  };
});

const { loadPackageExample } = await import('./io');
const { useStore } = await import('./store');

const PUBLIC = join(__dirname, '..', 'public');
const fetched: string[] = [];
let fetchFails = false;
beforeAll(() => {
  vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
  vi.stubGlobal('fetch', async (url: URL) => {
    fetched.push(url.pathname);
    if (fetchFails) return new Response('', { status: 503 });
    return new Response(readFileSync(join(PUBLIC, url.pathname), 'utf8'));
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ toasts: [] });
  rCall.mockReset();
  fetched.length = 0;
  withoutCopy = false;
  fetchFails = false;
});

const hs = () =>
  JSON.parse(
    readFileSync(join(PUBLIC, 'examples/data/lavaan/HolzingerSwineford1939.json'), 'utf8'),
  );

it('opens lavaan’s Holzinger & Swineford example from the bundled copy, without R', async () => {
  await loadPackageExample('lavaan-hs');
  expect(rCall).not.toHaveBeenCalled();
  expect(fetched).toEqual(['/examples/data/lavaan/HolzingerSwineford1939.json']);
  const s = useStore.getState();
  expect(s.example).toBe('lavaan-hs');
  expect(s.dataInfo).toMatchObject({ fileName: 'lavaan::HolzingerSwineford1939', rows: 301 });
  expect(s.data!.names).toEqual(hs().names);
  expect(Array.from(s.data!.cols[s.data!.names.indexOf('x1')])).toEqual(
    hs().cols[hs().names.indexOf('x1')],
  );
  // (factor levels from the copy, as from R: school's categories)
  expect(s.data!.categories?.school).toEqual(['Grant-White', 'Pasteur']);
  expect(s.toasts.map((t) => t.kind)).not.toContain('error');
});

it('applies the example’s missing-value codes as R did (the copy is per set of codes)', async () => {
  const ex = (await import('./examples/packages')).PACKAGE_EXAMPLES.find(
    (e) => e.data.package === 'seminr' && e.data.na?.length,
  )!;
  await loadPackageExample(ex.id);
  expect(rCall).not.toHaveBeenCalled();
  expect(fetched).toEqual(['/examples/data/seminr/corp_rep_data.na-99.json']);
  expect(useStore.getState().dataInfo!.missingCells).toBeGreaterThan(0);
});

it('asks R when there is no bundled copy, or the copy cannot be loaded', async () => {
  rCall.mockResolvedValue(hs());
  withoutCopy = true;
  await loadPackageExample('lavaan-hs');
  expect(fetched).toEqual([]);
  expect(rCall).toHaveBeenCalledWith(
    'ps_dataset',
    { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] },
    'lavaan',
  );
  expect(useStore.getState().dataInfo!.rows).toBe(301);

  rCall.mockClear();
  useStore.getState().newProject();
  withoutCopy = false;
  fetchFails = true;
  await loadPackageExample('lavaan-hs');
  expect(fetched).toHaveLength(1);
  expect(rCall).toHaveBeenCalledTimes(1);
  expect(useStore.getState().dataInfo!.rows).toBe(301);
});
