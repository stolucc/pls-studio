# Deploying PLS Studio

These scripts install PLS Studio on a Debian/Ubuntu server. It can be a server
that already runs other apps, such as FlowTex. PLS Studio gets its own:

| Resource | Name |
|---|---|
| Service account | `plsstudio` (home `/var/lib/plsstudio`) |
| App directory | `/opt/pls-studio` (layout below) |
| Config + secrets | `/etc/pls-studio/pls-studio.env` (640 root:plsstudio) |
| Database / role | `pls_studio` / `pls_studio` |
| systemd unit | `pls-studio.service`, listening on 127.0.0.1:8787 only |
| Caddy site | `/etc/caddy/conf.d/pls-studio.caddy` |
| Backups | `/var/backups/pls-studio` (daily dumps and pre-deploy dumps) |

The scripts don't start, stop or edit any other app. The one shared file is
`/etc/caddy/Caddyfile`. The provisioner only appends
`import /etc/caddy/conf.d/*.caddy` to it if that line is missing. FlowTex's own
`provision-vps.sh` already writes that line, so re-provisioning FlowTex keeps
PLS Studio's site. Caddy is reloaded, never restarted, so other sites stay up.

| Script | What it does |
|---|---|
| `pls-provision.sh` | First install, and re-running it after server-level changes |
| `pls-update.sh` | Routine deploy: build a release, back up, switch, health check, roll back on failure |
| `pls-backup.sh` | Database dump with rotation |

## First install

1. **DNS:** add an `A`/`AAAA` record for the host name, e.g. `pls.flowtex.click`,
   pointing at the server. A `CNAME` to `flowtex.click` also works. Wait until
   `dig +short pls.flowtex.click` shows the server's IP. The provisioner refuses
   to run before that, because each failed certificate request counts against
   Let's Encrypt's rate limit.
2. **Copy the provisioner to the server.** The repository is private, so the
   server can't download it yet:
   ```bash
   scp deploy/pls-provision.sh you@server:
   ```
3. **First run.** This creates a read-only deploy key, prints it and stops:
   ```bash
   sudo DOMAIN=pls.flowtex.click bash pls-provision.sh
   ```
   Add the printed key at github.com/stolucc/pls-studio, under Settings, then Deploy
   keys, then Add deploy key. Leave "Allow write access" unticked.
4. **Second run:**
   ```bash
   sudo DOMAIN=pls.flowtex.click bash pls-provision.sh
   ```
   This run:
   - clones the repository (bare, into `/opt/pls-studio/repo.git`)
   - creates the database and the secrets
   - installs the service and the Caddy site
   - builds and starts the app

   The first build downloads the pinned R runtime and packages, about 400 MB.
   They are checked against `scripts/webr/webr-lock.json`.
5. **Save `DATA_MASTER_KEY`** from `/etc/pls-studio/pls-studio.env` in your
   password manager. Without it, stored datasets can't be decrypted.

You can set these on the provisioner's command line. They are only used when the
config file is first created:
- `SMTP_URL`, e.g. `smtps://user:pass@smtp.example.org:465`
- `MAIL_FROM`
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

Other optional settings:
- `PLS_PORT`, default 8787.
- `PLS_MEMORY_MAX`, the systemd memory cap, default `1G`.

**Node:** PLS Studio needs Node 22.18 or newer within 22.x, because the server
runs its TypeScript directly. If the server already has an older Node 22, the
provisioner stops and explains how to upgrade. It never changes a Node that
other apps share.

## Layout

```
/opt/pls-studio/
  repo.git/                          bare clone; deploys fetch into it
  releases/000012-20261114T101500Z-1a2b3c4d5e6f/   one built release each
  releases/000013-20261115T090000Z-6f5e4d3c2b1a/     (REVISION: its commit)
  current -> releases/000013-…       the live release
  deploy  -> current/deploy          these scripts, at the documented path
```

The service runs `/opt/pls-studio/current/server` (`WorkingDirectory` and
`ExecStart` in the unit) and serves `STATIC_DIR=/opt/pls-studio/current/dist`
(in the config file). A release is a full tree: source (`git archive`, no
`.git`), `node_modules`, `server/node_modules`, `public/webr` and the built
`dist`.

## Updates

```bash
sudo bash /opt/pls-studio/deploy/pls-update.sh
```

How an update runs:
1. **Build.** The branch is fetched into `repo.git` and the new commit built
   in its own directory under `releases/`: server `npm ci`, R runtime, type
   check and client build. Unchanged dependencies (lockfile as in the live
   release) and the R runtime are hard-linked from the live release instead
   of installed again; `FORCE_NPM=1` installs them anyway. Nothing the
   running service uses changes during the build. A failed build is removed
   and the site runs on as before.
2. **Back up.** The database is dumped to
   `/var/backups/pls-studio/pre-deploy-<time>-<old commit>.dump` (the newest
   5 are kept). If the dump fails, the deploy stops before switching.
3. **Switch.** `current` is pointed at the new release in one rename, the
   service restarted (database migrations run when it starts) and
   `/api/health` checked for up to 45 s.
4. **Roll back.** If the new release is not healthy, `current` is pointed back
   at the previous release, the service restarted and checked again, and the
   script ends with an error, the log and how to restore the pre-deploy dump.
   The database is **not** restored automatically: a failed start is often
   unrelated to the database, and a restore discards everything users saved
   since the dump, so a person decides (see [Rollback](#rollback)).
5. **Prune.** The newest 3 releases are kept (`KEEP_RELEASES=`, at least 2;
   the live and the previous release always stay). Each release holds a
   built client including the R runtime (about 400 MB; `node_modules` and
   `public/webr` are shared hard links where unchanged).

Script changes take effect on the next deploy: the script that runs is the
live release's.

`index.html` is revalidated on every page load, so users don't need a hard refresh.

### First deploy after the switch to releases

Installs from before releases have a plain checkout at `/opt/pls-studio`.
`pls-update.sh` migrates it on its first run:
- the checkout's `.git` is cloned to `repo.git` (same GitHub remote; the
  deploy key and `/etc/pls-studio/pls-studio.env` stay where they are);
- the checkout itself, built as it is, is hard-linked into `releases/` and
  `current` points at it, so the deploy can roll back to it;
- before switching, the unit's `WorkingDirectory`/`ExecStart` and the config
  file's `STATIC_DIR` are pointed through `current` (the originals are kept as
  `/etc/pls-studio/pls-studio.service.before-releases` and
  `/etc/pls-studio/pls-studio.env.before-releases`);
- only when the new release is healthy are the old checkout files removed
  from `/opt/pls-studio`, and `deploy` becomes a link to `current/deploy`.
  If it is not healthy, the service goes back to the old checkout's release
  and the old files stay; the next deploy finishes the migration.

The script on disk in the old checkout is the old one. Run the new script
straight from the repository (recommended):

```bash
sudo -u plsstudio -H env GIT_SSH_COMMAND="ssh -i /var/lib/plsstudio/.ssh/pls_studio_deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=/var/lib/plsstudio/.ssh/known_hosts -o StrictHostKeyChecking=yes" \
  git -C /opt/pls-studio fetch origin main
sudo -u plsstudio git -C /opt/pls-studio show origin/main:deploy/pls-update.sh | sudo tee /root/pls-update.sh >/dev/null
sudo bash /root/pls-update.sh && sudo rm /root/pls-update.sh
```

(Running `sudo bash /opt/pls-studio/deploy/pls-update.sh` twice also works:
the first run is an old-style deploy, the second migrates.)

Check afterwards:

```bash
ls -l /opt/pls-studio                       # current -> releases/…, deploy -> current/deploy, repo.git, releases
systemctl cat pls-studio | grep -E 'WorkingDirectory|ExecStart'   # …/current/server
sudo grep STATIC_DIR /etc/pls-studio/pls-studio.env               # …/current/dist
curl -s http://127.0.0.1:8787/api/health
```

## Config changes

Edit `/etc/pls-studio/pls-studio.env`, then run `sudo systemctl restart pls-studio`.

- **Email:** set `SMTP_URL`. New accounts must verify their address by email before
  they can share projects, so a public deployment needs it. Without it, verification,
  password-reset and invitation emails are written to the log
  (`journalctl -u pls-studio`).
- **Google sign-in:** create a separate OAuth client for PLS Studio rather than
  reusing FlowTex's. Use the redirect URI
  `https://<domain>/api/auth/google/callback`.

## Backups

```bash
sudo bash /opt/pls-studio/deploy/pls-backup.sh          # one-off
echo '30 3 * * * root bash /opt/pls-studio/deploy/pls-backup.sh >/dev/null' \
  | sudo tee /etc/cron.d/pls-studio-backup                # daily 03:30
```

The script keeps 14 dumps by default (`KEEP=`). Datasets inside the dumps stay
encrypted. Keep `DATA_MASTER_KEY` somewhere else, not next to the dumps.

To restore: `sudo -u postgres pg_restore --clean --if-exists -d pls_studio FILE`

## Useful commands

```bash
systemctl status pls-studio
journalctl -u pls-studio -f
curl -s http://127.0.0.1:8787/api/health      # {"ok":true}
```

## Rollback

A deploy that fails its health check rolls back by itself. To go back to an
earlier release by hand (e.g. a bug found later):

```bash
ls /opt/pls-studio/releases                  # oldest first; cat …/REVISION for the commit
cd /opt/pls-studio
sudo ln -sfn releases/<release> current.next && sudo mv -T current.next current
sudo systemctl restart pls-studio
curl -s http://127.0.0.1:8787/api/health
```

The next `pls-update.sh` deploys the branch again; to stay on an older commit,
revert it on the branch.

**Database.** Releases only roll back code. If the failed release migrated
the database and the previous release does not work with the newer schema,
or data it wrote has to go, restore the dump made just before the deploy
(the deploy prints its name; everything saved after it is lost):

```bash
ls -t /var/backups/pls-studio/pre-deploy-*.dump | head -1
sudo systemctl stop pls-studio
sudo -u postgres pg_restore --clean --if-exists -d pls_studio /var/backups/pls-studio/pre-deploy-<time>-<commit>.dump
sudo systemctl start pls-studio
```

**The unit and config from before releases** are kept as
`/etc/pls-studio/pls-studio.service.before-releases` and
`/etc/pls-studio/pls-studio.env.before-releases`. They point at
`/opt/pls-studio/server` and `/opt/pls-studio/dist`, which exist only until
the migration's first healthy deploy; after that, roll back by release as
above instead.

## Desktop R helper and a deployment

The helper (helper/) trusts only the development origins out of the box. Every person who uses it with
this deployment allows the site once on their own computer, then restarts the helper:

```
pls-studio-helper allow-origin https://pls.example.edu
```

The app shows this command (with the right address) under Calculated by when it cannot reach the helper.
