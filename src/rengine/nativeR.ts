// The tests' native mode (PS_NATIVE_R=1): the bridge's R functions run in desktop R instead of webR, on a pool of
// the helper's own R workers (helper/r/worker.R, one JSON request per line on stdin, one marked reply per line on
// stdout), started from this Node process with the helper's R library. Every rCall / rCallParallel then goes to
// desktop R through the helper client's transport hook (helper.ts setHelperTransport); tests that drive webR
// directly (withR with their own R code) keep using webR. Several times faster than webR, for development; the
// validation record is still produced with webR, which is what the browser computes (setup.ts refuses the pair).

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HelperReply, HelperRequest, HelperTransport } from './helper';

const MARK = '\x1ePSH\x1e';

class Worker {
  private proc: ChildProcess;
  private buf = '';
  private waiting = new Map<string, (rep: HelperReply) => void>();
  private ready: Promise<{ r: string }>;
  busy = false;
  constructor(script: string, bridgeDir: string, library: string) {
    this.proc = spawn('Rscript', ['--vanilla', script, bridgeDir], { env: { ...process.env, PS_HELPER_LIBRARY: library, R_LIBS_USER: library }, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    this.proc.stderr!.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });  // (R's messages, kept for errors)
    this.ready = new Promise((resolve, reject) => {
      this.waiting.set('', (rep) => { const r = rep as { ready?: boolean; r?: string; message?: string }; if (r.ready) resolve({ r: String(r.r ?? 'R') }); else reject(new Error(r.message ?? 'R did not start.')); });
      this.proc.on('exit', (code) => reject(new Error(`The R worker exited (${code}).${err ? `\n${err}` : ''}`)));
    });
    this.proc.stdout!.setEncoding('utf8');
    this.proc.stdout!.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        const at = line.indexOf(MARK);
        if (at < 0) continue;  // (package output that escaped capture)
        const rep = JSON.parse(line.slice(at + MARK.length)) as HelperReply & { ready?: boolean };
        const key = rep.ready !== undefined ? '' : rep.id ?? '';
        const w = this.waiting.get(key);
        if (w) { this.waiting.delete(key); w(rep); }
      }
    });
  }
  start() { return this.ready; }
  call(r: HelperRequest): Promise<HelperReply> {
    return new Promise((resolve) => {
      this.waiting.set(r.id, resolve);
      this.proc.stdin!.write(`${JSON.stringify(r)}\n`);
    });
  }
  stop() { this.proc.stdin!.end(); this.proc.kill(); }
}

export interface NativePool extends HelperTransport { stop(): void }

/** The helper's R library on this machine (what `pls-studio-helper setup` installs), or PS_HELPER_LIBRARY. */
export function helperLibrary(): string {
  const env = process.env.PS_HELPER_LIBRARY;
  if (env) return env;
  const home = join(homedir(), '.pls-studio-helper', 'library');
  if (existsSync(home)) return home;
  throw new Error('No R library for the native mode: run `pls-studio-helper setup`, or set PS_HELPER_LIBRARY.');
}

/** Start `size` R workers on the bridge in `root/src/rengine/R`; one call at a time per worker, calls queued across them. */
export async function startNativePool(root: string, size: number): Promise<NativePool> {
  const script = join(root, 'helper', 'r', 'worker.R'), bridgeDir = join(root, 'src', 'rengine', 'R'), library = helperLibrary();
  const workers = Array.from({ length: size }, () => new Worker(script, bridgeDir, library));
  const [{ r }] = await Promise.all(workers.map((w) => w.start()));
  const queue: (() => void)[] = [];
  const acquire = (): Promise<Worker> => new Promise((resolve) => {
    const take = () => { const w = workers.find((x) => !x.busy); if (!w) { queue.push(take); return; } w.busy = true; resolve(w); };
    take();
  });
  const release = (w: Worker) => { w.busy = false; queue.shift()?.(); };
  const call = async (req: HelperRequest) => { const w = await acquire(); try { return await w.call(req); } finally { release(w); } };
  return {
    info: { helperVersion: 'native-tests', r, workers: size },
    call,
    async batch(calls, onReply) { await Promise.all(calls.map(async (c) => onReply(await call(c)))); },
    async packages(packages) {
      const rep = await call({ id: `pk${Date.now()}`, fn: 'ps_helper_packages', req: '', export: false, packages }) as HelperReply & { versions?: Record<string, string | null> };
      return Object.fromEntries(packages.map((p) => [p, rep.versions?.[p] ?? null]));
    },
    stop() { for (const w of workers) w.stop(); },
  };
}
