#!/usr/bin/env bash
# PLS Studio — one-shot provisioner for a Debian/Ubuntu server.
#
# Designed to live next to other apps (e.g. FlowTex) on the same host.
# Everything it creates is PLS-specific and named so:
#
#   service account   plsstudio            (home /var/lib/plsstudio)
#   checkout          /opt/pls-studio
#   config            /etc/pls-studio/pls-studio.env   (secrets, 640 root:plsstudio)
#   database / role   pls_studio / pls_studio          (in the shared PostgreSQL)
#   systemd unit      pls-studio.service               (127.0.0.1:8787)
#   Caddy site        /etc/caddy/conf.d/pls-studio.caddy
#
# It never edits another app's files. The one shared file it may touch is
# /etc/caddy/Caddyfile, and only to append `import /etc/caddy/conf.d/*.caddy`
# when that line is missing (FlowTex's provision-vps.sh writes it itself).
# Caddy is reloaded, not restarted, so other sites stay up.
#
# USAGE (as root, on the server)
#   1. DNS: point DOMAIN (e.g. pls.flowtex.click) at this server first.
#   2. sudo DOMAIN=pls.flowtex.click bash pls-provision.sh
#      The first run creates a read-only GitHub deploy key, prints it and
#      stops. Add it at github.com/stolucc/pls-studio > Settings > Deploy keys
#      (leave "Allow write access" unticked), then run the same command again.
#   Re-running later is safe: existing secrets, database and checkout are kept.
#   Routine updates: sudo bash /opt/pls-studio/deploy/pls-update.sh
#
# ENV (all optional except DOMAIN on the first run)
#   DOMAIN           public host name, e.g. pls.flowtex.click
#   REPO_URL         default git@github.com:stolucc/pls-studio.git
#   BRANCH           default main
#   PLS_PORT         default 8787 (loopback only; Caddy proxies to it)
#   PLS_MEMORY_MAX   systemd MemoryMax for the server, default 1G
#   SMTP_URL         nodemailer URL, e.g. smtps://user:pass@smtp.example.org:465
#   MAIL_FROM        default "PLS Studio <no-reply@DOMAIN>"
#   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   optional Google sign-in
#   (SMTP_URL, MAIL_FROM and GOOGLE_* are only used when the config file is
#    first created; afterwards edit /etc/pls-studio/pls-studio.env.)
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:stolucc/pls-studio.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/pls-studio
APP_USER=plsstudio
APP_HOME=/var/lib/plsstudio
SERVICE=pls-studio
CONF_DIR=/etc/pls-studio
ENV_FILE=$CONF_DIR/pls-studio.env
CADDY_SITE=/etc/caddy/conf.d/pls-studio.caddy
PLS_PORT="${PLS_PORT:-8787}"
PLS_MEMORY_MAX="${PLS_MEMORY_MAX:-1G}"
DEPLOY_KEY=$APP_HOME/.ssh/pls_studio_deploy
KNOWN_HOSTS=$APP_HOME/.ssh/known_hosts
NODE_MIN_MINOR=18   # Node 22.18+ runs the server's TypeScript directly

log()  { printf '\n\033[1;35m[pls]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pls] WARNING:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pls] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo DOMAIN=... bash $0"
command -v apt-get >/dev/null || die "Debian/Ubuntu (apt-get) required."

# DOMAIN: from the environment, or from an existing config on re-runs.
if [ -z "${DOMAIN:-}" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN="$(sed -n 's#^APP_ORIGIN=https://##p' "$ENV_FILE" | head -1)"
fi
: "${DOMAIN:?Set DOMAIN, e.g. sudo DOMAIN=pls.flowtex.click bash $0}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "DOMAIN '$DOMAIN' is not a valid host name."
[[ "$PLS_PORT" =~ ^[0-9]+$ ]] || die "PLS_PORT must be a number."

# ── DNS must resolve before Caddy asks Let's Encrypt for a certificate ──
# (failed ACME attempts count against the rate limit).
getent hosts "$DOMAIN" >/dev/null 2>&1 \
  || die "$DOMAIN does not resolve yet. Add the DNS record (A/AAAA or CNAME to this server), wait for it to show up in 'dig +short $DOMAIN', then re-run."

# ── Packages ─────────────────────────────────────────────────────────────
log "Checking system packages"
NEED=()
for pkg in git curl openssl ca-certificates; do dpkg -s "$pkg" >/dev/null 2>&1 || NEED+=("$pkg"); done
command -v psql >/dev/null || NEED+=(postgresql)
command -v ssh-keygen >/dev/null || NEED+=(openssh-client)
if [ ${#NEED[@]} -gt 0 ]; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${NEED[@]}"
fi

# Node: install 22.x only if there is no Node at all. If another app on this
# host already uses Node, never change it from here — just say what's needed.
if ! command -v node >/dev/null; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_V="$(node -v | tr -d v)"
NODE_MAJOR="${NODE_V%%.*}"; NODE_REST="${NODE_V#*.}"; NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -ne 22 ] || [ "$NODE_MINOR" -lt "$NODE_MIN_MINOR" ]; then
  die "PLS Studio needs Node 22.$NODE_MIN_MINOR or newer 22.x (found $NODE_V). Node is shared with other apps on this host, so this script won't change it. Upgrade within 22.x with: apt-get update && apt-get install --only-upgrade nodejs — then restart the other Node apps (e.g. systemctl restart 'flowtex*') and re-run."
fi
log "Node $NODE_V"

if ! command -v caddy >/dev/null; then
  log "Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
  # Fresh Caddy: replace the package's placeholder site with just the import.
  printf 'import /etc/caddy/conf.d/*.caddy\n' > /etc/caddy/Caddyfile
fi

# ── Port must be free (or already ours) ──────────────────────────────────
if ss -Hltn "sport = :$PLS_PORT" 2>/dev/null | grep -q . && ! systemctl is-active --quiet "$SERVICE"; then
  die "Port $PLS_PORT is already in use by something else. Pick another: PLS_PORT=8788 ..."
fi

# ── Service account ──────────────────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creating service account $APP_USER"
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi

# ── Read-only deploy key for the private repository ──────────────────────
if [[ "$REPO_URL" == git@* || "$REPO_URL" == ssh://* ]]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"
  # GitHub's published host key (docs.github.com > GitHub's SSH key fingerprints).
  # Pinned instead of ssh-keyscan so the first connection can't be intercepted.
  printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$KNOWN_HOSTS"
  chown "$APP_USER:$APP_USER" "$KNOWN_HOSTS"; chmod 644 "$KNOWN_HOSTS"
  if [ ! -f "$DEPLOY_KEY" ]; then
    sudo -u "$APP_USER" ssh-keygen -q -t ed25519 -N '' -C "pls-studio deploy $(hostname)" -f "$DEPLOY_KEY"
    cat <<KEY

  A deploy key was created. Add it to GitHub, then run this script again:

    github.com/stolucc/pls-studio > Settings > Deploy keys > Add deploy key
    Title: $(hostname) (read-only)      "Allow write access": leave UNTICKED

$(cat "$DEPLOY_KEY.pub")

KEY
    exit 0
  fi
fi

# ── Checkout ─────────────────────────────────────────────────────────────
export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes"
if [ ! -d "$APP_DIR/.git" ]; then
  log "Cloning $REPO_URL ($BRANCH) into $APP_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" -H env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" \
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR" \
    || die "Clone failed. Is the deploy key added on GitHub (Settings > Deploy keys)?"
fi

# ── PostgreSQL: role + database ──────────────────────────────────────────
systemctl enable --now postgresql
PG_PASSWORD=""
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='pls_studio'" | grep -q 1; then
  log "PostgreSQL role pls_studio exists — keeping it"
else
  log "Creating PostgreSQL role + database pls_studio"
  PG_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE pls_studio LOGIN PASSWORD '${PG_PASSWORD}';
CREATE DATABASE pls_studio OWNER pls_studio;
SQL
fi
# citext is created by the app's first migration; create it as superuser here
# so that works even where the extension isn't marked trusted.
sudo -u postgres psql -q -d pls_studio -c 'CREATE EXTENSION IF NOT EXISTS citext;'

# ── Config + secrets ─────────────────────────────────────────────────────
install -d -m 750 -o root -g "$APP_USER" "$CONF_DIR"
if [ -f "$ENV_FILE" ]; then
  log "$ENV_FILE exists — keeping it (secrets are never rotated by this script)"
  grep -q "^APP_ORIGIN=https://$DOMAIN\$" "$ENV_FILE" \
    || warn "APP_ORIGIN in $ENV_FILE differs from https://$DOMAIN — edit it if the domain changed."
else
  [ -n "$PG_PASSWORD" ] || die "$ENV_FILE is missing but the pls_studio DB role already exists, so its password is unknown. Restore the config file (or: sudo -u postgres psql -c \"ALTER ROLE pls_studio PASSWORD '...'\" and write it yourself)."
  log "Writing $ENV_FILE with fresh secrets"
  umask 027
  {
    echo "# PLS Studio — generated by pls-provision.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Back up DATA_MASTER_KEY somewhere OFF this server: without it, stored"
    echo "# datasets cannot be decrypted. Keep it apart from the database backups."
    echo "NODE_ENV=production"
    echo "PORT=$PLS_PORT"
    echo "APP_ORIGIN=https://$DOMAIN"
    echo "DATABASE_URL=postgres://pls_studio:${PG_PASSWORD}@localhost:5432/pls_studio"
    echo "STATIC_DIR=$APP_DIR/dist"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "DATA_MASTER_KEY=$(openssl rand -base64 32)"
    echo "TOTP_KEY=$(openssl rand -base64 32)"
    echo "MAIL_FROM=${MAIL_FROM:-PLS Studio <no-reply@$DOMAIN>}"
    if [ -n "${SMTP_URL:-}" ]; then echo "SMTP_URL=$SMTP_URL"; else echo "# SMTP_URL=smtps://user:pass@smtp.example.org:465   (unset: invitation emails go to the journal)"; fi
    if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
      echo "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
      echo "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
    else
      echo "# Google sign-in: redirect URI https://$DOMAIN/api/auth/google/callback"
      echo "# GOOGLE_CLIENT_ID="
      echo "# GOOGLE_CLIENT_SECRET="
    fi
  } > "$ENV_FILE"
  umask 022
fi
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

# ── systemd ──────────────────────────────────────────────────────────────
log "Installing $SERVICE.service"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=PLS Studio collaboration server
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/server/src/index.ts
Restart=on-failure
RestartSec=5
# Sharing the host with other apps: cap memory so a runaway can't starve them.
MemoryMax=$PLS_MEMORY_MAX

# Hardening. The server keeps all state in PostgreSQL; it writes no files.
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

# ── Caddy site ───────────────────────────────────────────────────────────
log "Configuring Caddy site $DOMAIN -> 127.0.0.1:$PLS_PORT"
install -d /etc/caddy/conf.d
cat > "$CADDY_SITE" <<CADDY
# PLS Studio — managed by $APP_DIR/deploy/pls-provision.sh
$DOMAIN {
	reverse_proxy 127.0.0.1:$PLS_PORT
	encode zstd gzip
	tls {
		protocols tls1.2 tls1.3
	}
}
CADDY
if ! grep -qE '^[[:space:]]*import[[:space:]]+/etc/caddy/conf\.d/\*\.caddy' /etc/caddy/Caddyfile; then
  log "Adding 'import /etc/caddy/conf.d/*.caddy' to /etc/caddy/Caddyfile"
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-pls-$(date +%Y%m%d%H%M%S)"
  printf '\nimport /etc/caddy/conf.d/*.caddy\n' >> /etc/caddy/Caddyfile
fi
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
  rm -f "$CADDY_SITE"
  die "Caddy rejected the configuration (shown above); $CADDY_SITE was removed and Caddy was not reloaded."
fi

# ── Build + start (same path as routine updates) ─────────────────────────
log "Building and starting PLS Studio (first build downloads the R runtime, ~400 MB)"
bash "$APP_DIR/deploy/pls-update.sh"

systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

cat <<DONE

$(printf '\033[1;32m')✓ PLS Studio is provisioned and running.$(printf '\033[0m')

  URL        https://$DOMAIN   (Caddy fetches the certificate on first visit)
  Service    systemctl status $SERVICE   |   journalctl -u $SERVICE -f
  Config     $ENV_FILE   (640 root:$APP_USER)
  Database   pls_studio (role pls_studio)

Next:
  1. Copy DATA_MASTER_KEY from $ENV_FILE to your password manager.
  2. Email: set SMTP_URL in $ENV_FILE, then: systemctl restart $SERVICE
  3. Google sign-in (optional): new OAuth client, redirect URI
     https://$DOMAIN/api/auth/google/callback — set GOOGLE_CLIENT_ID/SECRET, restart.
  4. Backups: $APP_DIR/deploy/pls-backup.sh (see deploy/README.md for a cron line).

Updates:   sudo bash $APP_DIR/deploy/pls-update.sh
DONE
