// Opening an example whose data are downloaded (load.ts): the desktop helper first when it is connected, then the
// server's pass-through; the input read for the file name; a clear message with the source's page when neither
// answers. fetch and the helper are stand-ins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { remoteDataset } from './load';
import { RICLPM_DATA } from './source';

const helper = vi.hoisted(() => ({
  connected: false,
  files: {} as Record<string, string>,
  asked: [] as string[],
}));
vi.mock('../../rengine/helper', () => ({
  helperConnected: () => helper.connected,
  helperExampleData: async (path: string) => {
    helper.asked.push(path);
    if (!(path in helper.files)) throw new Error('helper: 404');
    return new TextEncoder().encode(helper.files[path]);
  },
}));

const INP =
  'TITLE: survival\nDATA: FILE IS ex6.19.dat;\nVARIABLE: NAMES ARE u1-u2 x;\n MISSING = ALL (999);\n';
const DAT = '0 1 0.5\n1 999 -1.25\n';
let served: Record<string, Response | (() => Response)> = {};
let asked: string[] = [];
beforeEach(() => {
  helper.connected = false;
  helper.files = {};
  helper.asked = [];
  served = {};
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      const r = served[url];
      if (!r) throw new TypeError('Failed to fetch');
      return typeof r === 'function' ? r() : r;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const text =
  (body: string, status = 200, type = 'text/plain; charset=iso-8859-1') =>
  () =>
    new Response(body, { status, headers: { 'content-type': type } });
const api = (p: string) => `/api/example-data/statmodel/${p}`;

describe('downloaded example data', () => {
  it('reads the input, then the data file it names, through the server; converts and reshapes them', async () => {
    served = { [api('chap6/ex6.19.inp')]: text(INP), [api('chap6/ex6.19.dat')]: text(DAT) };
    const { data, fileName } = await remoteDataset({
      kind: 'mplus',
      example: '6.19',
      reshape: {
        kind: 'personPeriod',
        events: ['u1', 'u2'],
        id: 'id',
        period: 'period',
        event: 'u',
      },
    });
    expect(fileName).toBe('ex6.19.dat');
    expect(data.names).toEqual(['id', 'period', 'u', 'x']);
    expect(data.cols.map((c) => Array.from(c))).toEqual([
      [1, 1, 2],
      [1, 2, 1],
      [0, 1, 1],
      [0.5, 0.5, -1.25],
    ]);
    expect(asked).toEqual([api('chap6/ex6.19.inp'), api('chap6/ex6.19.dat')]);
  });

  it('asks the connected helper first, and the server for what the helper cannot give', async () => {
    helper.connected = true;
    helper.files = { 'chap6/ex6.19.inp': INP };
    served = { [api('chap6/ex6.19.dat')]: text(DAT) };
    const { data } = await remoteDataset({ kind: 'mplus', example: '6.19' });
    expect(data.cols[0].length).toBe(2);
    expect(helper.asked).toEqual(['chap6/ex6.19.inp', 'chap6/ex6.19.dat']);
    expect(asked).toEqual([api('chap6/ex6.19.dat')]);
  });

  it('says where to get the data when neither the server nor the helper answers (also a static host’s page)', async () => {
    await expect(remoteDataset({ kind: 'mplus', example: '6.19' })).rejects.toThrow(
      /downloaded from statmodel\.com.*neither could be reached.*https:\/\/www\.statmodel\.com\/usersguide\/chap6\/ex6\.19\.html/,
    );
    served = {
      [api('chap6/ex6.19.inp')]: text('<!doctype html><title>PLS Studio</title>', 200, 'text/html'),
    };
    await expect(remoteDataset({ kind: 'mplus', example: '6.19' })).rejects.toThrow(
      /neither could be reached/,
    );
    served = {
      [api('chap6/ex6.19.inp')]: text(
        JSON.stringify({ error: 'statmodel.com does not have this file.' }),
        404,
        'application/json',
      ),
    };
    await expect(remoteDataset({ kind: 'mplus', example: '6.19' })).rejects.toThrow(
      /does not have chap6\/ex6\.19\.inp/,
    );
  });

  it('refuses a data file that is not one of the guide’s', async () => {
    served = {
      [api('chap6/ex6.19.inp')]: text('DATA: FILE IS ../../etc/passwd;\nVARIABLE: NAMES = a;\n'),
    };
    await expect(remoteDataset({ kind: 'mplus', example: '6.19' })).rejects.toThrow(
      /not one of the guide’s data files/,
    );
    expect(asked).toEqual([api('chap6/ex6.19.inp')]);
  });

  it('reads a pinned URL directly (RI-CLPM), with the tutorial’s column names', async () => {
    served = {
      [RICLPM_DATA.kind === 'url' ? RICLPM_DATA.url : '']: text(
        '  0.1 0.2 0.3 0.4 0.5 -0.1 -0.2 -0.3 -0.4 -0.5\n'.repeat(3),
      ),
    };
    const { data, fileName } = await remoteDataset(RICLPM_DATA);
    expect(fileName).toBe('RICLPM.dat');
    expect(data.names).toEqual(['x1', 'x2', 'x3', 'x4', 'x5', 'y1', 'y2', 'y3', 'y4', 'y5']);
    expect(Array.from(data.cols[9])).toEqual([-0.5, -0.5, -0.5]);
    expect(asked[0]).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/JeroenDMulder\/RI-CLPM\/[0-9a-f]{40}\/data\/RICLPM\.dat$/,
    );
    served = {};
    await expect(remoteDataset(RICLPM_DATA)).rejects.toThrow(
      /raw\.githubusercontent\.com.*https:\/\/github\.com\/JeroenDMulder\/RI-CLPM/,
    );
  });
});
