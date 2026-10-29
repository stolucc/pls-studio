#!/usr/bin/env bash
# PLS Studio — routine deploy: pull, build, restart, health-check.
#
#   sudo bash /opt/pls-studio/deploy/pls-update.sh
#
# Run as root; git/npm/build run as the plsstudio service account. Touches
# only PLS Studio (pls-studio.service, /opt/pls-studio) — never other apps.
#
# The new client is built into dist.next and swapped in only after the build
# succeeds, so a failed build leaves the running site as it was. The previous
# build stays in dist.prev until the next successful deploy (rollback:
# stop the service, mv dist dist.bad && mv dist.prev dist, git checkout the
# old commit, start the service).
#
# ENV
#   BRANCH       default main
#   FORCE_NPM=1  run npm ci even if the lockfiles did not change
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR=/opt/pls-studio
APP_USER=plsstudio
APP_HOME=/var/lib/plsstudio
SERVICE=pls-studio
ENV_FILE=/etc/pls-studio/pls-studio.env
DEPLOY_KEY=$APP_HOME/.ssh/pls_studio_deploy
KNOWN_HOSTS=$APP_HOME/.ssh/known_hosts
FORCE_NPM="${FORCE_NPM:-0}"

log()  { printf '\033[1;35m[pls]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[pls] ✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[pls] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash $0"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a checkout — run deploy/pls-provision.sh first."
[ -f "$ENV_FILE" ] || die "$ENV_FILE missing — run deploy/pls-provision.sh first."

# One deploy at a time.
exec 9>/run/lock/pls-studio-deploy.lock
flock -n 9 || die "Another PLS Studio deploy is running."

GIT_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes"
as_app() { sudo -u "$APP_USER" -H env GIT_SSH_COMMAND="$GIT_SSH" HOME="$APP_HOME" "$@"; }
in_app() { (cd "$APP_DIR" && as_app "$@"); }

# ── Pull ─────────────────────────────────────────────────────────────────
OLD_SHA="$(in_app git rev-parse HEAD)"
log "Fetching $BRANCH"
in_app git fetch --quiet origin "$BRANCH"
in_app git checkout --quiet "$BRANCH"
in_app git reset --quiet --hard "origin/$BRANCH"
NEW_SHA="$(in_app git rev-parse HEAD)"
if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  log "Already at ${NEW_SHA:0:7}; rebuilding anyway"
else
  log "${OLD_SHA:0:7} -> ${NEW_SHA:0:7}"
fi

lock_changed() { [ "$OLD_SHA" != "$NEW_SHA" ] && ! in_app git diff --quiet "$OLD_SHA" "$NEW_SHA" -- "$1"; }

# ── Dependencies ─────────────────────────────────────────────────────────
if [ "$FORCE_NPM" = 1 ] || [ ! -d "$APP_DIR/node_modules" ] || lock_changed package-lock.json; then
  log "npm ci (client)"
  in_app npm ci --no-audit --no-fund
fi
if [ "$FORCE_NPM" = 1 ] || [ ! -d "$APP_DIR/server/node_modules" ] || lock_changed server/package-lock.json; then
  log "npm ci (server, production deps)"
  (cd "$APP_DIR/server" && as_app npm ci --omit=dev --no-audit --no-fund)
fi

# ── Build ────────────────────────────────────────────────────────────────
# The pinned R runtime + packages (public/webr): downloaded only when they
# don't match scripts/webr/webr-lock.json, MD5-verified, sources included.
log "R runtime (webR) — fetching if the lock changed"
in_app node scripts/webr/fetch.mjs --if-missing

log "Type-check + build client into dist.next"
in_app rm -rf dist.next
in_app npx tsc -b
in_app npx vite build --outDir dist.next --emptyOutDir --logLevel warn
[ -f "$APP_DIR/dist.next/index.html" ] || die "Build produced no index.html; the running site is unchanged."

in_app rm -rf dist.prev
[ -d "$APP_DIR/dist" ] && in_app mv dist dist.prev
in_app mv dist.next dist
ok "Client swapped in"

# ── Restart + health ─────────────────────────────────────────────────────
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -1)"; PORT="${PORT:-8787}"
ORIGIN="$(sed -n 's/^APP_ORIGIN=//p' "$ENV_FILE" | head -1)"
log "Restarting $SERVICE (migrations run on start)"
systemctl restart "$SERVICE"
for i in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 45 ]; then
    journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
    die "$SERVICE did not become healthy on :$PORT (log above). Previous client build is in $APP_DIR/dist.prev."
  fi
  sleep 1
done
ok "$SERVICE healthy on 127.0.0.1:$PORT"

# Through Caddy too (catches TLS/proxy problems). Not fatal: on the very first
# deploy Caddy is only reloaded after this script, by pls-provision.sh.
if [ -n "$ORIGIN" ] && systemctl is-active --quiet caddy; then
  if curl -fsS --max-time 10 "$ORIGIN/api/health" >/dev/null 2>&1; then
    ok "$ORIGIN/api/health reachable"
  else
    log "Note: $ORIGIN/api/health not reachable yet (certificate pending, DNS, or Caddy not reloaded)."
  fi
fi

ok "PLS Studio ${NEW_SHA:0:7} deployed. Users: hard refresh not needed (index.html is revalidated)."
