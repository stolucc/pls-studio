# Deploying PLS Studio

These scripts install PLS Studio on a Debian/Ubuntu server. It can be a server
that already runs other apps, such as FlowTex. PLS Studio gets its own:

| Resource | Name |
|---|---|
| Service account | `plsstudio` (home `/var/lib/plsstudio`) |
| Checkout | `/opt/pls-studio` |
| Config + secrets | `/etc/pls-studio/pls-studio.env` (640 root:plsstudio) |
| Database / role | `pls_studio` / `pls_studio` |
| systemd unit | `pls-studio.service`, listening on 127.0.0.1:8787 only |
| Caddy site | `/etc/caddy/conf.d/pls-studio.caddy` |
| Backups | `/var/backups/pls-studio` |

The scripts don't start, stop or edit any other app. The one shared file is
`/etc/caddy/Caddyfile`. The provisioner only appends
`import /etc/caddy/conf.d/*.caddy` to it if that line is missing. FlowTex's own
`provision-vps.sh` already writes that line, so re-provisioning FlowTex keeps
PLS Studio's site. Caddy is reloaded, never restarted, so other sites stay up.

| Script | What it does |
|---|---|
| `pls-provision.sh` | First install, and re-running it after server-level changes |
| `pls-update.sh` | Routine deploy: pull, build, restart, health check |
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
   - clones the repository
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

## Updates

```bash
sudo bash /opt/pls-studio/deploy/pls-update.sh
```

How an update runs:
- The client is built into `dist.next` and only swapped in once the build
  succeeds. A failed build leaves the live site untouched.
- The previous build is kept in `dist.prev`.
- `npm ci` runs only when a lockfile changed. `FORCE_NPM=1` forces it.
- Database migrations run when the service starts.
- `index.html` is revalidated on every page load, so users don't need a hard refresh.

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

```bash
sudo systemctl stop pls-studio
cd /opt/pls-studio
sudo -u plsstudio mv dist dist.bad && sudo -u plsstudio mv dist.prev dist
sudo -u plsstudio git checkout <previous-sha>
sudo systemctl start pls-studio
```
