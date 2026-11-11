// Opening an example whose data PLS Studio does not distribute (source.ts): the data are downloaded from their source
// every time, converted in the browser (convert.ts) and reshaped where the example says so (reshape.ts). Nothing is
// stored. statmodel.com sends no CORS header, so the browser cannot read it: the desktop helper fetches the Mplus
// files when it is connected, otherwise the PLS Studio server passes them through (server/src/routes/exampleData.ts).

import { parseCsv } from '../../engine/dataset';
import type { Dataset } from '../../engine/types';
import { freeFormatCsv, latin1, mplusInput } from './convert';
import { reshape } from './reshape';
import {
  mplusChapter,
  mplusInputPath,
  remoteHost,
  remotePage,
  statmodelPath,
  type RemoteData,
} from './source';

/** Why the data could not be downloaded, with the page where a person can get them. */
function unreachable(r: RemoteData, how: string): Error {
  return new Error(
    `This example’s data are not distributed with PLS Studio: they are downloaded from ${remoteHost(r)} each time the example is opened, ${how}. You can get them from ${remotePage(r)}.`,
  );
}

/** A file of the Mplus User's Guide from statmodel.com: through the desktop helper when it is connected, else the server. */
export async function fetchStatmodel(path: string, r: RemoteData): Promise<Uint8Array> {
  if (!statmodelPath(path))
    throw new Error(`${path} is not a file of the Mplus User’s Guide examples.`);
  const { helperConnected, helperExampleData } = await import('../../rengine/helper');
  if (helperConnected()) {
    try {
      return await helperExampleData(path);
    } catch {
      /* (an older helper, or it stopped: the server) */
    }
  }
  let res: Response;
  try {
    res = await fetch(`/api/example-data/statmodel/${path}`, {
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw unreachable(
      r,
      'through the PLS Studio server or the desktop helper, and neither could be reached',
    );
  }
  const type = res.headers.get('content-type') ?? '';
  if (res.ok && type.startsWith('text/plain')) return new Uint8Array(await res.arrayBuffer());
  if (type.startsWith('application/json')) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    if (error && res.status !== 404)
      throw unreachable(r, `but the server could not download ${path} (${error})`);
    if (error) throw unreachable(r, `but ${remoteHost(r)} does not have ${path}`);
  }
  // (a deployment without the server: its static host answers with the app's page, or not at all)
  throw unreachable(
    r,
    'through the PLS Studio server or the desktop helper, and neither could be reached',
  );
}

/** The converted CSV of a downloaded file as the example's dataset: parsed as a shipped CSV is, then reshaped. */
export function remoteFromCsv(csv: string, r: RemoteData): Dataset {
  const data = parseCsv(csv).dataset;
  return r.reshape ? reshape(data, r.reshape) : data;
}

/** Download, convert and reshape an example's data; `fileName` is the downloaded data file's name. */
export async function remoteDataset(r: RemoteData): Promise<{ data: Dataset; fileName: string }> {
  if (r.kind === 'mplus') {
    const info = mplusInput(latin1(await fetchStatmodel(mplusInputPath(r.example), r)));
    if (!info) throw new Error(`Mplus example ${r.example} reads no data file.`);
    const path = statmodelPath(`chap${mplusChapter(r.example)}/${info.file}`);
    if (!path)
      throw new Error(
        `Mplus example ${r.example} reads ${info.file}, which is not one of the guide’s data files.`,
      );
    const { csv } = freeFormatCsv(
      latin1(await fetchStatmodel(path, r)),
      info.names,
      info.missing,
      `Mplus example ${r.example}`,
    );
    return { data: remoteFromCsv(csv, r), fileName: info.file };
  }
  const fileName = r.url.split('/').pop()!;
  let res: Response;
  try {
    res = await fetch(r.url, {
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw unreachable(r, 'and it could not be reached');
  }
  if (!res.ok) throw unreachable(r, `but it answered ${res.status}`);
  const { csv } = freeFormatCsv(
    latin1(new Uint8Array(await res.arrayBuffer())),
    r.names,
    [],
    fileName,
  );
  return { data: remoteFromCsv(csv, r), fileName };
}

/** A file a person downloaded from the source themselves and chose in the app. */
export interface ChosenFile {
  name: string;
  bytes: Uint8Array;
}

/** Where a person can download an example's files themselves: its page and, for Mplus, its chapter's zip archive. */
export function downloadLinks(r: RemoteData): { label: string; url: string }[] {
  if (r.kind === 'url')
    return [
      { label: r.url.split('/').pop()!, url: r.url },
      { label: 'Its source', url: r.page },
    ];
  const ch = mplusChapter(r.example);
  return [
    { label: `ex${r.example}.inp and the .dat it reads (the example’s page)`, url: remotePage(r) },
    {
      label: `All of chapter ${ch} (chapter${ch}.zip)`,
      url: `https://www.statmodel.com/usersguide/chap${ch}/chapter${ch}.zip`,
    },
  ];
}

/**
 * The example's data from files the person downloaded themselves (chosen or dropped in the app): for Mplus the
 * example's input (for the variable names) and the data file it reads, given as files or inside the chapter's zip
 * archive; otherwise the source's data file. Converted and reshaped exactly as a download is.
 */
export async function importedDataset(
  r: RemoteData,
  files: ChosenFile[],
): Promise<{ data: Dataset; fileName: string }> {
  const base = (n: string) => n.split(/[\\/]/).pop()!.toLowerCase();
  const { zipEntries, zipEntry } = await import('./unzip');
  /** The chosen file named `name` (any folder, any case), loose or inside a chosen zip archive. */
  const find = async (name: string): Promise<Uint8Array | null> => {
    const want = name.toLowerCase();
    const loose = files.find((f) => base(f.name) === want);
    if (loose) return loose.bytes;
    for (const f of files.filter((x) => base(x.name).endsWith('.zip'))) {
      const entries = zipEntries(f.bytes);
      for (const [n, e] of entries) if (base(n) === want) return zipEntry(f.bytes, e);
    }
    return null;
  };
  if (r.kind === 'url') {
    const fileName = r.url.split('/').pop()!;
    const bytes = await find(fileName);
    if (!bytes) throw new Error(`Choose ${fileName}, the file downloaded from ${remoteHost(r)}.`);
    const { csv } = freeFormatCsv(latin1(bytes), r.names, [], fileName);
    return { data: remoteFromCsv(csv, r), fileName };
  }
  const inpName = `ex${r.example}.inp`;
  const inp = await find(inpName);
  if (!inp)
    throw new Error(
      `Choose ${inpName} too (it holds the variable names), or the chapter’s zip archive.`,
    );
  const info = mplusInput(latin1(inp));
  if (!info) throw new Error(`${inpName} reads no data file.`);
  const dat = await find(info.file);
  if (!dat) throw new Error(`Choose ${info.file} too: ${inpName} reads its data from it.`);
  const { csv } = freeFormatCsv(
    latin1(dat),
    info.names,
    info.missing,
    `Mplus example ${r.example}`,
  );
  return { data: remoteFromCsv(csv, r), fileName: info.file };
}
