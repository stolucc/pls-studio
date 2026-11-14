// The deploy scripts share a server with FlowTex. These checks pin down the
// separation guarantees: PLS-only names, the shared Caddyfile only ever
// appended to, and builds that never replace the live client before they succeed.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const DIR = __dirname;
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const SCRIPTS = ['pls-provision.sh', 'pls-update.sh', 'pls-backup.sh'];
const provision = read('pls-provision.sh');
const update = read('pls-update.sh');

describe('deploy scripts', () => {
  it.each(SCRIPTS)('%s is valid bash with strict mode', (f) => {
    expect(() => execFileSync('bash', ['-n', join(DIR, f)])).not.toThrow();
    expect(read(f)).toContain('set -euo pipefail');
  });

  it('never manages another app’s services or files', () => {
    for (const f of SCRIPTS) {
      // Mentioning flowtex in comments and messages is fine; acting on it is not.
      const code = read(f)
        .split('\n')
        .filter((l) => !/^\s*(#|die |log |warn |echo )/.test(l));
      for (const line of code) {
        if (/systemctl\s+(restart|stop|start|reload|disable|enable)/.test(line)) {
          expect(line, `${f}: ${line}`).not.toMatch(/flowtex/);
        }
        expect(line, `${f}: ${line}`).not.toMatch(/\/opt\/flowtex/);
      }
    }
  });

  it('uses PLS-specific names for every resource it creates', () => {
    expect(provision).toMatch(/^APP_DIR=\/opt\/pls-studio$/m);
    expect(provision).toMatch(/^APP_USER=plsstudio$/m);
    expect(provision).toMatch(/^SERVICE=pls-studio$/m);
    expect(provision).toMatch(/^ENV_FILE=\$CONF_DIR\/pls-studio\.env$/m);
    expect(provision).toMatch(/^CADDY_SITE=\/etc\/caddy\/conf\.d\/pls-studio\.caddy$/m);
    expect(provision).toContain('CREATE DATABASE pls_studio OWNER pls_studio;');
    for (const f of ['pls-update.sh']) {
      expect(read(f)).toMatch(/^APP_DIR=\/opt\/pls-studio$/m);
      expect(read(f)).toMatch(/^SERVICE=pls-studio$/m);
    }
  });

  it('only appends to the shared Caddyfile, except when Caddy was just installed', () => {
    const overwrites = provision
      .split('\n')
      .filter((l) => /[^>]>\s*\/etc\/caddy\/Caddyfile\b/.test(l));
    expect(overwrites).toHaveLength(1);
    const freshInstall = provision.slice(
      provision.indexOf('if ! command -v caddy'),
      provision.indexOf('# ── Port must be free'),
    );
    expect(freshInstall).toContain(overwrites[0]);
    expect(provision).toContain('>> /etc/caddy/Caddyfile');
    // Validated before reload; reload (not restart) keeps other sites up.
    expect(provision.indexOf('caddy validate')).toBeLessThan(
      provision.indexOf('systemctl reload caddy'),
    );
  });

  it('proxies the site to the loopback port only', () => {
    expect(provision).toContain('reverse_proxy 127.0.0.1:$PLS_PORT');
  });

  it('refuses to change a Node version other apps rely on', () => {
    const nodeBlock = provision.slice(
      provision.indexOf('# Node:'),
      provision.indexOf('log "Node $NODE_V"'),
    );
    expect(nodeBlock).toMatch(/if ! command -v node/);
    expect(nodeBlock).toMatch(/die "PLS Studio needs Node 22/);
    expect(nodeBlock).not.toMatch(/--only-upgrade nodejs\s*$/m);
  });

  it('pins GitHub’s host key instead of trusting the first connection', () => {
    const code = provision
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/ssh-keyscan/);
    expect(provision).toContain('StrictHostKeyChecking=yes');
    expect(update).toContain('StrictHostKeyChecking=yes');
  });

  it('builds, backs up, then switches and restarts, in that order', () => {
    const main = update.slice(update.indexOf('main() {'));
    const steps = [
      'build_release',
      'backup_database',
      'use_current_paths',
      'point_current "$NEW_NAME"',
      'restart_service',
      'wait_healthy || roll_back',
      'remove_old_checkout',
      'prune_releases',
    ].map((step) => main.indexOf(step));
    expect(steps).not.toContain(-1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // The release counts as built only once the client exists.
    const build = update.slice(
      update.indexOf('build_release() {'),
      update.indexOf('# ── Database backup'),
    );
    expect(build.indexOf('vite build --outDir dist')).toBeLessThan(
      build.indexOf('[ -f "$PARTIAL/dist/index.html" ]'),
    );
  });

  it('never restores the database by itself', () => {
    // pg_restore only in the instructions printed for a person (the HELP here-document).
    const withoutHelp = update.replace(/<<HELP\n[\s\S]*?\nHELP\n/, '');
    expect(withoutHelp).not.toContain('pg_restore');
    expect(update).toContain('sudo -u postgres pg_restore --clean --if-exists -d pls_studio $DUMP');
  });

  it('runs the service through the current symlink', () => {
    expect(provision).toContain('WorkingDirectory=$APP_DIR/current/server');
    expect(provision).toContain('ExecStart=/usr/bin/node $APP_DIR/current/server/src/index.ts');
    expect(provision).toContain('echo "STATIC_DIR=$APP_DIR/current/dist"');
  });

  it('keeps secrets out of the repository and readable only by root and the service', () => {
    expect(provision).toMatch(/^CONF_DIR=\/etc\/pls-studio$/m);
    expect(provision).toContain('chmod 640 "$ENV_FILE"');
    expect(provision).toContain('install -d -m 750 -o root -g "$APP_USER" "$CONF_DIR"');
  });
});

// pls-update.sh run for real against a scratch directory: the script is
// sourced and only what needs root or the server is replaced (sudo, flock,
// systemctl, pg_dump, the health check), with npm/npx/node stubs that build
// a fake client. The repository is a local git repository.
describe('pls-update.sh (stubbed run)', () => {
  const sandboxes: string[] = [];
  afterEach(() => {
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.org',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.org',
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();

  const STUBS: Record<string, string> = {
    npm: `echo "npm $* in $PWD" >> "$LOG"
if [ "$1" = ci ]; then rm -rf node_modules && mkdir node_modules && echo "$PWD" > node_modules/marker; fi`,
    node: `if [ "$1" = scripts/webr/fetch.mjs ] && [ ! -f public/webr/.lock-stamp ]; then
  echo "webr fetch in $PWD" >> "$LOG"; mkdir -p public/webr.next && echo stamp > public/webr.next/.lock-stamp
  rm -rf public/webr && mv public/webr.next public/webr
fi`,
    npx: `case "$1" in
  tsc) if [ -f BREAK_BUILD ]; then echo "src/x.ts: type error" >&2; exit 2; fi ;;
  vite) mkdir -p dist && echo '<!doctype html>' > dist/index.html ;;
esac`,
  };

  /** A repository with a commit, and an /opt/pls-studio, /etc and backups in a scratch directory. */
  function sandbox() {
    const root = mkdtempSync(join(tmpdir(), 'pls-deploy-'));
    sandboxes.push(root);
    const origin = join(root, 'origin');
    const app = join(root, 'opt', 'pls-studio');
    const etc = join(root, 'etc');
    const bin = join(root, 'bin');
    for (const d of [origin, dirname(app), etc, bin]) mkdirSync(d, { recursive: true });
    for (const [name, body] of Object.entries(STUBS)) {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    git(origin, 'init', '-q', '-b', 'main');
    const files: Record<string, string> = {
      'package-lock.json': '{"lock":1}\n',
      'server/package-lock.json': '{"lock":1}\n',
      'server/src/index.ts': '// server\n',
      'deploy/pls-update.sh': update,
      'index.html': '<!doctype html>\n',
    };
    const commit = (changes: Record<string, string | null>, message: string) => {
      for (const [file, content] of Object.entries(changes)) {
        const path = join(origin, file);
        if (content === null) {
          rmSync(path, { force: true });
        } else {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
        }
      }
      git(origin, 'add', '-A');
      git(origin, 'commit', '-q', '-m', message);
      return git(origin, 'rev-parse', 'HEAD');
    };
    const first = commit(files, 'first');
    const envFile = join(etc, 'pls-studio.env');
    const unitFile = join(etc, 'pls-studio.service');
    const log = join(root, 'log');
    writeFileSync(log, '');

    /** The layout pls-provision.sh makes now: a bare repo.git, nothing built yet. */
    const provisionNew = () => {
      git(dirname(app), 'clone', '-q', '--bare', origin, app + '/repo.git');
      writeFileSync(
        envFile,
        `PORT=8787\nAPP_ORIGIN=https://pls.example.org\nSTATIC_DIR=${app}/current/dist\n`,
      );
      writeFileSync(
        unitFile,
        `[Service]\nWorkingDirectory=${app}/current/server\nExecStart=/usr/bin/node ${app}/current/server/src/index.ts\nMemoryMax=1G\n`,
      );
    };
    /** The layout before releases: a plain, built checkout at /opt/pls-studio. */
    const provisionOld = () => {
      git(dirname(app), 'clone', '-q', origin, app);
      for (const d of ['node_modules', 'server/node_modules', 'dist', 'public/webr', 'dist.prev']) {
        mkdirSync(join(app, d), { recursive: true });
      }
      writeFileSync(join(app, 'node_modules', 'marker'), 'old checkout\n');
      writeFileSync(join(app, 'server', 'node_modules', 'marker'), 'old checkout\n');
      writeFileSync(join(app, 'dist', 'index.html'), '<!doctype html>\n');
      writeFileSync(join(app, 'public', 'webr', '.lock-stamp'), 'stamp\n');
      writeFileSync(
        envFile,
        `PORT=8787\nAPP_ORIGIN=https://pls.example.org\nSTATIC_DIR=${app}/dist\n`,
      );
      writeFileSync(
        unitFile,
        `[Service]\nWorkingDirectory=${app}/server\nExecStart=/usr/bin/node ${app}/server/src/index.ts\nMemoryMax=1G\n`,
      );
    };

    const harness = join(root, 'harness.sh');
    writeFileSync(
      harness,
      `source ${JSON.stringify(join(DIR, 'pls-update.sh'))}
APP_DIR=${JSON.stringify(app)}
ENV_FILE=${JSON.stringify(envFile)}
UNIT_FILE=${JSON.stringify(unitFile)}
BACKUP_DIR=${JSON.stringify(join(root, 'backups'))}
require_root() { :; }
take_lock() { :; }
as_app() { "$@"; }
chown() { :; }
systemctl() { echo "systemctl $*" >> "$LOG"; [ "$1" != is-active ]; }
journalctl() { :; }
sleep() { :; }
restart_service() { echo "restart $(cat "$APP_DIR/current/REVISION")" >> "$LOG"; }
wait_healthy() { [ ! -e "$APP_DIR/current/BREAK_HEALTH" ]; }
dump_database() {
  if [ -n "\${FAIL_BACKUP:-}" ]; then echo "pg_dump: connection refused" >&2; return 1; fi
  mkdir -p "$BACKUP_DIR" && echo dump > "$1"
}
main
`,
    );

    /** Runs pls-update.sh; status, output and the log of stubbed commands. */
    const deploy = (env: Record<string, string> = {}) => {
      writeFileSync(log, '');
      const r = spawnSync('bash', [harness], {
        encoding: 'utf8',
        env: { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, LOG: log, ...env },
      });
      return { status: r.status, output: r.stdout + r.stderr, log: readFileSync(log, 'utf8') };
    };

    const releasesDir = join(app, 'releases');
    const releases = () => (existsSync(releasesDir) ? readdirSync(releasesDir).sort() : []);
    const revision = (release: string) =>
      readFileSync(join(releasesDir, release, 'REVISION'), 'utf8').trim();
    const current = () => readlinkSync(join(app, 'current'));
    const currentRevision = () => readFileSync(join(app, 'current', 'REVISION'), 'utf8').trim();
    const backups = () =>
      existsSync(join(root, 'backups')) ? readdirSync(join(root, 'backups')) : [];

    return {
      root,
      app,
      origin,
      envFile,
      unitFile,
      etc,
      first,
      commit,
      provisionNew,
      provisionOld,
      deploy,
      releases,
      revision,
      current,
      currentRevision,
      backups,
    };
  }

  it('builds a fresh install into a release and points current, deploy and the backup at it', () => {
    const s = sandbox();
    s.provisionNew();
    const r = s.deploy();
    expect(r.status, r.output).toBe(0);
    expect(s.releases()).toHaveLength(1);
    expect(s.current()).toBe(`releases/${s.releases()[0]}`);
    expect(s.currentRevision()).toBe(s.first);
    expect(existsSync(join(s.app, 'current', 'dist', 'index.html'))).toBe(true);
    expect(readlinkSync(join(s.app, 'deploy'))).toBe('current/deploy');
    expect(existsSync(join(s.app, 'deploy', 'pls-update.sh'))).toBe(true);
    expect(s.backups()).toEqual([expect.stringMatching(/^pre-deploy-\d{8}T\d{6}Z-none\.dump$/)]);
    expect(r.log).toMatch(/npm ci --no-audit/);
    expect(r.log).toContain(`restart ${s.first}`);
  });

  it('links unchanged dependencies from the live release, installs changed ones', () => {
    const s = sandbox();
    s.provisionNew();
    expect(s.deploy().status).toBe(0);
    const second = s.commit({ 'src/app.ts': 'export {};\n' }, 'code only');
    const r = s.deploy();
    expect(r.status, r.output).toBe(0);
    expect(s.currentRevision()).toBe(second);
    expect(r.log).not.toContain('npm ci');
    expect(r.log).not.toContain('webr fetch');
    const [prev, now] = s.releases();
    const inode = (release: string, file: string) =>
      statSync(join(s.app, 'releases', release, file)).ino;
    expect(inode(now, 'node_modules/marker')).toBe(inode(prev, 'node_modules/marker'));
    expect(inode(now, 'public/webr/.lock-stamp')).toBe(inode(prev, 'public/webr/.lock-stamp'));

    s.commit({ 'server/package-lock.json': '{"lock":2}\n' }, 'server deps');
    const r2 = s.deploy();
    expect(r2.status, r2.output).toBe(0);
    expect(r2.log).toMatch(/npm ci --omit=dev .* in .*\/server$/m);
    expect(r2.log).not.toMatch(/npm ci --no-audit --no-fund in/);
    // FORCE_NPM=1 installs both.
    expect(s.deploy({ FORCE_NPM: '1' }).log.match(/npm ci/g)).toHaveLength(2);
  });

  it('leaves current and the running service alone when the build fails', () => {
    const s = sandbox();
    s.provisionNew();
    expect(s.deploy().status).toBe(0);
    const before = s.current();
    s.commit({ BREAK_BUILD: '1' }, 'broken');
    const r = s.deploy();
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('type error');
    expect(r.output).toMatch(/failed .*removed and the site still runs/);
    expect(s.current()).toBe(before);
    expect(s.releases()).toHaveLength(1); // the half-built release is gone
    expect(r.log).not.toContain('restart');
    expect(r.log).not.toContain('daemon-reload');
    expect(s.backups()).toHaveLength(1); // only the first deploy's
  });

  it('aborts before switching when the database backup fails', () => {
    const s = sandbox();
    s.provisionNew();
    expect(s.deploy().status).toBe(0);
    const before = s.current();
    s.commit({ 'src/app.ts': 'export {};\n' }, 'next');
    const r = s.deploy({ FAIL_BACKUP: '1' });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('database backup failed, so nothing was deployed');
    expect(s.current()).toBe(before);
    expect(r.log).not.toContain('restart');
  });

  it('switches back to the previous release when the new one is unhealthy, and says how to restore the dump', () => {
    const s = sandbox();
    s.provisionNew();
    expect(s.deploy().status).toBe(0);
    const before = s.current();
    const bad = s.commit({ BREAK_HEALTH: '1' }, 'crashes on start');
    const r = s.deploy();
    expect(r.status).not.toBe(0);
    expect(s.current()).toBe(before);
    expect(
      r.log
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('restart')),
    ).toEqual([`restart ${bad}`, `restart ${s.first}`]);
    expect(r.output).toContain('Rolled back');
    const dump = s.backups().find((f) => f.includes(s.first.slice(0, 12)));
    expect(dump).toBeDefined();
    expect(r.output).toContain(
      `pg_restore --clean --if-exists -d pls_studio ${join(s.root, 'backups', dump!)}`,
    );
    expect(r.output).toContain('not done automatically');
    // The failed release is kept for inspection.
    expect(s.releases().map(s.revision)).toEqual([s.first, bad]);
  });

  it('migrates a plain checkout to releases on the first run', () => {
    const s = sandbox();
    s.provisionOld();
    const next = s.commit({ 'src/app.ts': 'export {};\n' }, 'next');
    const r = s.deploy();
    expect(r.status, r.output).toBe(0);
    // The old checkout became the first release (rollback target), the new commit the second.
    const [old, now] = s.releases();
    expect(s.revision(old)).toBe(s.first);
    expect(s.revision(now)).toBe(next);
    expect(s.current()).toBe(`releases/${now}`);
    expect(readFileSync(join(s.app, 'releases', old, 'node_modules', 'marker'), 'utf8')).toBe(
      'old checkout\n',
    );
    expect(existsSync(join(s.app, 'releases', old, 'dist', 'index.html'))).toBe(true);
    expect(existsSync(join(s.app, 'releases', old, 'dist.prev'))).toBe(false);
    // Unchanged lockfiles: the old checkout's node_modules are reused.
    expect(r.log).not.toContain('npm ci');
    // The old checkout files are gone; repo.git fetches from the same remote.
    expect(readdirSync(s.app).sort()).toEqual(['current', 'deploy', 'releases', 'repo.git']);
    expect(lstatSync(join(s.app, 'deploy')).isSymbolicLink()).toBe(true);
    expect(git(join(s.app, 'repo.git'), 'remote', 'get-url', 'origin')).toBe(s.origin);
    // The unit and STATIC_DIR now go through current; the originals are kept.
    const unit = readFileSync(s.unitFile, 'utf8');
    expect(unit).toContain(`WorkingDirectory=${s.app}/current/server\n`);
    expect(unit).toContain(`ExecStart=/usr/bin/node ${s.app}/current/server/src/index.ts\n`);
    expect(unit).toContain('MemoryMax=1G');
    expect(readFileSync(s.envFile, 'utf8')).toContain(`STATIC_DIR=${s.app}/current/dist\n`);
    expect(readFileSync(join(s.etc, 'pls-studio.service.before-releases'), 'utf8')).toContain(
      `WorkingDirectory=${s.app}/server\n`,
    );
    expect(readFileSync(s.envFile + '.before-releases', 'utf8')).toContain(
      `STATIC_DIR=${s.app}/dist\n`,
    );
    expect(r.log).toContain('systemctl daemon-reload');
    // A later deploy runs in the new layout.
    s.commit({ 'src/app.ts': 'export const x = 1;\n' }, 'later');
    expect(s.deploy().status).toBe(0);
    expect(s.releases()).toHaveLength(3);
  });

  it('keeps the old checkout when the first new-layout release is unhealthy', () => {
    const s = sandbox();
    s.provisionOld();
    s.commit({ BREAK_HEALTH: '1' }, 'crashes on start');
    const r = s.deploy();
    expect(r.status).not.toBe(0);
    const [old] = s.releases();
    expect(s.current()).toBe(`releases/${old}`);
    expect(s.currentRevision()).toBe(s.first);
    expect(existsSync(join(s.app, '.git'))).toBe(true);
    expect(existsSync(join(s.app, 'server', 'src', 'index.ts'))).toBe(true);
    // Fixed: the next run finishes the migration.
    const fixed = s.commit({ BREAK_HEALTH: null }, 'fixed');
    const r2 = s.deploy();
    expect(r2.status, r2.output).toBe(0);
    expect(s.currentRevision()).toBe(fixed);
    expect(readdirSync(s.app).sort()).toEqual(['current', 'deploy', 'releases', 'repo.git']);
  });

  it('keeps the newest KEEP_RELEASES releases', () => {
    const s = sandbox();
    s.provisionNew();
    const shas = [s.first];
    expect(s.deploy().status).toBe(0);
    for (let i = 2; i <= 5; i++) {
      shas.push(s.commit({ 'src/app.ts': `export const v = ${i};\n` }, `v${i}`));
      expect(s.deploy().status).toBe(0);
    }
    expect(s.releases().map(s.revision)).toEqual(shas.slice(-3));
    expect(s.currentRevision()).toBe(shas[4]);
    shas.push(s.commit({ 'src/app.ts': 'export const v = 6;\n' }, 'v6'));
    expect(s.deploy({ KEEP_RELEASES: '2' }).status).toBe(0);
    expect(s.releases().map(s.revision)).toEqual(shas.slice(-2));
    expect(s.deploy({ KEEP_RELEASES: '1' }).output).toContain(
      'KEEP_RELEASES must be a number, at least 2',
    );
  });
});
