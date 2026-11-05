// Example data passed through from their source, for the browser app: the Mplus User's Guide examples at
// statmodel.com, which sends no CORS header (so the browser cannot fetch them itself) and states no licence (so PLS
// Studio does not distribute them). Each request downloads the one file it names; nothing is stored or logged.
//
// GET /api/example-data/statmodel/:chap/:file
//
// Against server-side request forgery: the upstream origin is a constant; the path must be one of the guide's
// example files (chapN/exN.M….inp|.dat, the chapter its own, nothing else: no "..", no encoded slashes, no query);
// the request is built from the validated path alone (no query, headers or cookies of the caller are passed on);
// redirects are not followed (a 3xx answer is an error); the answer must be 200 and is capped in size and time;
// a limiter and a cap on concurrent downloads keep the server from being used to flood statmodel.com.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { h } from '../app.ts';

export const STATMODEL_ORIGIN = 'https://www.statmodel.com';
/** The guide's example files, the only paths passed through (the same pattern as the client and the helper). */
export const STATMODEL_PATH = /^chap(\d{1,2})\/ex(\d{1,2})\.\d{1,2}[a-z0-9]*\.(dat|inp)$/;

export interface ExampleDataOptions {
  /** (tests) the fetch to use */
  fetch?: typeof fetch;
  /** Largest file passed through, bytes (the guide's largest is 2.6 MB). */
  maxBytes?: number;
  /** Time allowed for the whole download. */
  timeoutMs?: number;
  /** Requests per client IP per minute. */
  perMinute?: number;
  /** Downloads in progress at once, across clients. */
  maxConcurrent?: number;
}

/** The upstream URL of a requested file, or null when the path is not one of the guide's example files. */
export function statmodelUrl(chap: string, file: string): URL | null {
  const path = `${chap}/${file}`;
  const m = STATMODEL_PATH.exec(path);
  if (!m || m[1] !== m[2]) return null;
  const url = new URL(`/usersguide/${path}`, STATMODEL_ORIGIN);
  // (the pattern leaves the URL parser nothing to reinterpret; checked anyway)
  if (url.origin !== STATMODEL_ORIGIN || url.pathname !== `/usersguide/${path}` || url.search || url.hash) return null;
  return url;
}

class Upstream extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function exampleDataRoutes(opts: ExampleDataOptions = {}) {
  const doFetch = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxConcurrent = opts.maxConcurrent ?? 8;
  let inFlight = 0;
  const router = Router();
  // On top of the /api limiter: opening an example takes two files.
  router.use(rateLimit({ windowMs: 60_000, limit: opts.perMinute ?? 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many example downloads; try again in a minute.' } }));

  router.get('/statmodel/:chap/:file', h(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const url = statmodelUrl(String(req.params.chap), String(req.params.file));
    if (!url) return res.status(404).json({ error: 'Not one of the Mplus User’s Guide example files.' });
    if (inFlight >= maxConcurrent) return res.status(503).set('Retry-After', '5').json({ error: 'Busy; try again in a few seconds.' });
    inFlight++;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const up = await doFetch(url, { redirect: 'manual', signal, headers: { Accept: 'text/plain, */*', 'User-Agent': 'PLS Studio example data (no storage)' } });
      if (up.status !== 200) {
        await up.body?.cancel().catch(() => {});
        // (statmodel.com answers a missing file with 300 Multiple Choices, or a 301 to a similarly named file: a
        // redirect is never followed, whatever its target, and means the file asked for is not there)
        throw up.status === 404 || up.status === 410 || (up.status >= 300 && up.status < 400) ? new Upstream(404, 'statmodel.com does not have this file.') : new Upstream(502, `statmodel.com answered ${up.status}.`);
      }
      const declared = Number(up.headers.get('content-length'));
      if (declared > maxBytes) { await up.body?.cancel().catch(() => {}); throw new Upstream(502, 'The file is larger than allowed.'); }
      const chunks: Buffer[] = [];
      let size = 0;
      if (up.body) {
        for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > maxBytes) throw new Upstream(502, 'The file is larger than allowed.');
          chunks.push(Buffer.from(chunk));
        }
      }
      // The bytes as they are (the client decodes them as ISO-8859-1, as Mplus files are); never rendered as HTML.
      res.status(200).set({ 'Content-Type': 'text/plain; charset=iso-8859-1', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' })
        .send(Buffer.concat(chunks, size));
    } catch (e) {
      if (e instanceof Upstream) return res.status(e.status).json({ error: e.message });
      if (signal.aborted) return res.status(504).json({ error: 'statmodel.com did not answer in time.' });
      return res.status(502).json({ error: 'Could not reach statmodel.com.' });
    } finally {
      inFlight--;
    }
  }));
  return router;
}
