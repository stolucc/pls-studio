// The deploy scripts share a server with FlowTex. These checks pin down the
// separation guarantees: PLS-only names, the shared Caddyfile only ever
// appended to, and builds that never replace the live client before they succeed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
      const code = read(f).split('\n').filter((l) => !/^\s*(#|die |log |warn |echo )/.test(l));
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
    const overwrites = provision.split('\n').filter((l) => /[^>]>\s*\/etc\/caddy\/Caddyfile\b/.test(l));
    expect(overwrites).toHaveLength(1);
    const freshInstall = provision.slice(provision.indexOf('if ! command -v caddy'), provision.indexOf('# ── Port must be free'));
    expect(freshInstall).toContain(overwrites[0]);
    expect(provision).toContain(">> /etc/caddy/Caddyfile");
    // Validated before reload; reload (not restart) keeps other sites up.
    expect(provision.indexOf('caddy validate')).toBeLessThan(provision.indexOf('systemctl reload caddy'));
  });

  it('proxies the site to the loopback port only', () => {
    expect(provision).toContain('reverse_proxy 127.0.0.1:$PLS_PORT');
  });

  it('refuses to change a Node version other apps rely on', () => {
    const nodeBlock = provision.slice(provision.indexOf('# Node:'), provision.indexOf('log "Node $NODE_V"'));
    expect(nodeBlock).toMatch(/if ! command -v node/);
    expect(nodeBlock).toMatch(/die "PLS Studio needs Node 22/);
    expect(nodeBlock).not.toMatch(/--only-upgrade nodejs\s*$/m);
  });

  it('pins GitHub’s host key instead of trusting the first connection', () => {
    const code = provision.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/ssh-keyscan/);
    expect(provision).toContain('StrictHostKeyChecking=yes');
    expect(update).toContain('StrictHostKeyChecking=yes');
  });

  it('swaps the new client in only after the build succeeded', () => {
    const build = update.indexOf('vite build --outDir dist.next');
    const check = update.indexOf('[ -f "$APP_DIR/dist.next/index.html" ]');
    const swap = update.indexOf('in_app mv dist.next dist');
    const restart = update.indexOf('systemctl restart "$SERVICE"');
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(check);
    expect(check).toBeLessThan(swap);
    expect(swap).toBeLessThan(restart);
  });

  it('keeps secrets out of the repository and readable only by root and the service', () => {
    expect(provision).toMatch(/^CONF_DIR=\/etc\/pls-studio$/m);
    expect(provision).toContain('chmod 640 "$ENV_FILE"');
    expect(provision).toContain('install -d -m 750 -o root -g "$APP_USER" "$CONF_DIR"');
  });
});
