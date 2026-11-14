#!/usr/bin/env bash
# PLS Studio — routine deploy: fetch, build a new release, back up the
# database, switch, restart, health-check, roll back on failure.
#
#   sudo bash /opt/pls-studio/deploy/pls-update.sh
#
# Run as root; git/npm/build run as the plsstudio service account. Touches
# only PLS Studio (pls-studio.service, /opt/pls-studio, its database dumps in
# /var/backups/pls-studio) — never other apps.
#
# Layout (deploy/README.md):
#   /opt/pls-studio/repo.git              bare clone of the repository (fetched here)
#   /opt/pls-studio/releases/<n>-<time>-<sha>  one built release each (REVISION: its commit)
#   /opt/pls-studio/current               symlink to the live release; the service
#                                         runs current/server and serves current/dist
#   /opt/pls-studio/deploy                symlink to current/deploy (these scripts)
#
# 1. The new commit is built in its own release directory (server npm ci,
#    client build, R runtime). Nothing the running service uses changes
#    until that build succeeded; a failed build is removed and the site runs on.
# 2. The database is dumped (pre-deploy-<time>-<old sha>.dump); no dump, no deploy.
# 3. current is switched to the new release in one rename, the service
#    restarted (database migrations run on start) and /api/health checked.
# 4. Unhealthy: current is switched back to the previous release, restarted
#    and checked again. The database is NOT restored automatically (see
#    rollback_help below and deploy/README.md).
# The newest KEEP_RELEASES releases are kept (always the live one and the one before).
#
# A plain checkout at /opt/pls-studio (the layout before releases) is
# migrated on the first run: its .git becomes repo.git, the checkout itself
# (hard-linked) the first release, and after the new release is healthy the
# old checkout files are removed. The deploy key and the config file stay.
#
# ENV
#   BRANCH           default main
#   FORCE_NPM=1      run npm ci even if the lockfiles did not change
#   KEEP_RELEASES    releases to keep, default 3 (at least 2)
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR=/opt/pls-studio
APP_USER=plsstudio
APP_HOME=/var/lib/plsstudio
SERVICE=pls-studio
ENV_FILE=/etc/pls-studio/pls-studio.env
UNIT_FILE=/etc/systemd/system/pls-studio.service
BACKUP_DIR=/var/backups/pls-studio
LOCK_FILE=/run/lock/pls-studio-deploy.lock
DEPLOY_KEY=$APP_HOME/.ssh/pls_studio_deploy
KNOWN_HOSTS=$APP_HOME/.ssh/known_hosts
FORCE_NPM="${FORCE_NPM:-0}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
KEEP_PRE_DEPLOY_DUMPS=5

log()  { printf '\033[1;35m[pls]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[pls] ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pls] WARNING:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pls] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

GIT_SSH="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes"
as_app() { sudo -u "$APP_USER" -H env GIT_SSH_COMMAND="$GIT_SSH" HOME="$APP_HOME" "$@"; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash $0"
}

# One deploy at a time.
take_lock() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "Another PLS Studio deploy is running."
}

# ── Releases ─────────────────────────────────────────────────────────────
init_paths() {
  REPO=$APP_DIR/repo.git
  RELEASES=$APP_DIR/releases
  CURRENT=$APP_DIR/current
}

# A new release's directory name: <sequence>-<UTC time>-<commit>, so that
# names sort in deploy order (also two deploys within a second) and never
# collide (the same commit can be built again).
release_name() {
  local last seq=1
  last="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -name '[0-9][0-9][0-9][0-9][0-9][0-9]-*' -exec basename {} \; | sort | tail -1)"
  if [ -n "$last" ]; then
    seq=$((10#${last%%-*} + 1))
  fi
  printf '%06d-%s-%s' "$seq" "$(date -u +%Y%m%dT%H%M%SZ)" "${1:0:12}"
}

# The release current points to (its directory name), or nothing.
current_release() {
  [ -L "$CURRENT" ] || return 0
  basename "$(readlink "$CURRENT")"
}

# Point current at a release in one step (rename over the old symlink).
point_current() {
  ln -sfn "releases/$1" "$APP_DIR/current.next"
  if mv --version >/dev/null 2>&1; then
    mv -T "$APP_DIR/current.next" "$CURRENT"
  else
    mv -h "$APP_DIR/current.next" "$CURRENT"   # BSD mv (macOS: the tests)
  fi
}

# The layout before releases: /opt/pls-studio was a plain checkout. Its .git
# becomes the bare repo.git and the checkout, hard-linked, the first release,
# so the next steps can roll back to it. The running service keeps using the
# old paths until it is restarted into current.
migrate_old_layout() {
  log "Migrating $APP_DIR from a plain checkout to releases (first run of this layout)"
  local old_sha old_origin name
  old_sha="$( (cd "$APP_DIR" && as_app git rev-parse HEAD) )"
  old_origin="$( (cd "$APP_DIR" && as_app git remote get-url origin) )"
  if [ ! -d "$REPO" ]; then
    as_app git clone --quiet --bare "$APP_DIR" "$REPO"
    as_app git -C "$REPO" remote set-url origin "$old_origin"
  fi
  [ -d "$APP_DIR/dist" ] || warn "The old checkout has no built client (dist): rolling back to it would not work."
  as_app mkdir -p "$RELEASES"
  name="$(release_name "$old_sha")"
  local partial="$RELEASES/$name.partial"
  mkdir "$partial"
  # Hard links (cp -al, as root, keeps owners and modes): no second copy of
  # node_modules or the R runtime.
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name .git ! -name repo.git ! -name releases ! -name current ! -name current.next \
    ! -name dist.next ! -name dist.prev \
    -exec cp -al {} "$partial/" \;
  printf '%s\n' "$old_sha" > "$partial/REVISION"
  chown "$APP_USER:$APP_USER" "$partial" "$partial/REVISION"
  mv "$partial" "$RELEASES/$name"
  point_current "$name"
  ok "Old checkout ${old_sha:0:7} kept as release $name"
}

# After the first healthy release of the new layout: remove the old checkout's
# files (the release made from them stays until it is pruned) and leave
# deploy/ as a link to current/deploy, so the documented commands keep working.
remove_old_checkout() {
  [ -d "$APP_DIR/.git" ] || return 0
  log "Removing the old checkout files from $APP_DIR (now in releases/)"
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name repo.git ! -name releases ! -name current \
    -exec rm -rf {} +
}

link_deploy_dir() {
  if [ -L "$APP_DIR/deploy" ] || [ ! -e "$APP_DIR/deploy" ]; then
    ln -sfn current/deploy "$APP_DIR/deploy"
  fi
}

# Whether a lockfile differs between the live release and the new commit.
lock_changed() {
  [ -n "$OLD_SHA" ] || return 0
  [ "$OLD_SHA" != "$NEW_SHA" ] || return 1
  ! as_app git -C "$REPO" diff --quiet "$OLD_SHA" "$NEW_SHA" -- "$1"
}

# Hard-link a directory of the live release into the new one (unchanged
# dependencies, the R runtime and its source cache). Releases never change
# after they are built, and npm ci and fetch.mjs replace files rather than
# rewrite them, so the live release is never touched.
link_from_current() {
  if [ -z "$PREV_NAME" ] || [ ! -d "$RELEASES/$PREV_NAME/$1" ]; then
    return 1
  fi
  as_app mkdir -p "$(dirname "$PARTIAL/$1")"
  as_app cp -al "$RELEASES/$PREV_NAME/$1" "$PARTIAL/$1"
}

in_release() { (cd "$PARTIAL" && as_app "$@"); }

build_release() {
  NEW_NAME="$(release_name "$NEW_SHA")"
  PARTIAL="$RELEASES/$NEW_NAME.partial"
  log "Building ${NEW_SHA:0:7} in $RELEASES/$NEW_NAME"
  as_app mkdir "$PARTIAL"
  as_app git -C "$REPO" archive --format=tar "$NEW_SHA" | as_app tar -x -C "$PARTIAL"
  printf '%s\n' "$NEW_SHA" | as_app tee "$PARTIAL/REVISION" >/dev/null

  # Dependencies: hard-linked from the live release when the lockfile is
  # unchanged, else installed (FORCE_NPM=1: always installed).
  if [ "$FORCE_NPM" != 1 ] && ! lock_changed package-lock.json && link_from_current node_modules; then
    log "Client dependencies unchanged (linked)"
  else
    log "npm ci (client)"
    in_release npm ci --no-audit --no-fund
  fi
  if [ "$FORCE_NPM" != 1 ] && ! lock_changed server/package-lock.json && link_from_current server/node_modules; then
    log "Server dependencies unchanged (linked)"
  else
    log "npm ci (server, production deps)"
    (cd "$PARTIAL/server" && as_app npm ci --omit=dev --no-audit --no-fund)
  fi

  # The pinned R runtime + packages (public/webr): taken from the live release
  # and downloaded only when they don't match scripts/webr/webr-lock.json,
  # MD5-verified, sources included (cached in .webr-cache).
  link_from_current public/webr || true
  link_from_current .webr-cache || true
  log "R runtime (webR) — fetching if the lock changed"
  in_release node scripts/webr/fetch.mjs --if-missing

  log "Type-check + build client"
  in_release npx tsc -b
  in_release npx vite build --outDir dist --emptyOutDir --logLevel warn
  [ -f "$PARTIAL/dist/index.html" ] || die "Build produced no index.html."

  mv "$PARTIAL" "$RELEASES/$NEW_NAME"
  PARTIAL=""
  ok "Release $NEW_NAME built"
}

# ── Database backup ──────────────────────────────────────────────────────
dump_database() {
  install -d -m 700 -o postgres -g postgres "$BACKUP_DIR"
  if ! sudo -u postgres pg_dump --format=custom --file="$1.part" pls_studio; then
    rm -f "$1.part"
    return 1
  fi
  mv "$1.part" "$1"
  chmod 600 "$1"
}

backup_database() {
  local old_label=none
  if [ -n "$OLD_SHA" ]; then
    old_label="${OLD_SHA:0:12}"
  fi
  DUMP="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$old_label.dump"
  log "Backing up the database to $DUMP"
  dump_database "$DUMP" \
    || die "The database backup failed, so nothing was deployed: the site still runs ${OLD_SHA:0:7}. (The built release $NEW_NAME stays; it is pruned later.)"
  ok "Database backed up"
  # Keep the newest pre-deploy dumps (pls-backup.sh rotates the daily ones).
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -name 'pre-deploy-*.dump' | sort -r \
    | tail -n +"$((KEEP_PRE_DEPLOY_DUMPS + 1))" | while read -r old; do
    rm -f -- "$old"
  done
}

# ── Switch ───────────────────────────────────────────────────────────────
# Rewrite a root-owned file in place (keeps its owner and mode).
rewrite_file() {
  local file=$1
  shift
  (umask 077 && sed "$@" "$file" > "$file.new" && cat "$file.new" > "$file" && rm -f "$file.new")
}

# The unit and STATIC_DIR must point through current (the layout before
# releases pointed at $APP_DIR/server and $APP_DIR/dist). Copies of the
# originals stay next to the config file.
use_current_paths() {
  if grep -q "^WorkingDirectory=$APP_DIR/server\$" "$UNIT_FILE"; then
    log "Pointing $SERVICE.service through $CURRENT"
    cp -p "$UNIT_FILE" "$(dirname "$ENV_FILE")/$SERVICE.service.before-releases"
    rewrite_file "$UNIT_FILE" \
      -e "s#^WorkingDirectory=$APP_DIR/server\$#WorkingDirectory=$CURRENT/server#" \
      -e "s#^\(ExecStart=.* \)$APP_DIR/server/src/index\.ts\$#\1$CURRENT/server/src/index.ts#"
  fi
  if ! grep -q "^WorkingDirectory=$CURRENT/server\$" "$UNIT_FILE" \
    || ! grep -q "^ExecStart=.* $CURRENT/server/src/index\.ts\$" "$UNIT_FILE"; then
    die "$UNIT_FILE does not run $CURRENT/server (re-run deploy/pls-provision.sh); nothing was switched."
  fi

  if grep -q "^STATIC_DIR=$APP_DIR/dist\$" "$ENV_FILE"; then
    log "Pointing STATIC_DIR in $ENV_FILE through $CURRENT"
    cp -p "$ENV_FILE" "$ENV_FILE.before-releases"
    rewrite_file "$ENV_FILE" -e "s#^STATIC_DIR=$APP_DIR/dist\$#STATIC_DIR=$CURRENT/dist#"
  fi
  grep -q "^STATIC_DIR=$CURRENT/dist\$" "$ENV_FILE" \
    || die "STATIC_DIR in $ENV_FILE is not $CURRENT/dist; set it, then deploy again. Nothing was switched."
  systemctl daemon-reload
}

restart_service() {
  systemctl restart "$SERVICE" || true
}

# /api/health on the loopback port, for up to 45 s.
wait_healthy() {
  local i
  for i in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
  return 1
}

rollback_help() {
  cat >&2 <<HELP

  The database was backed up before this deploy:
    $DUMP
  The new release may have migrated the database when it started. If the
  previous release now fails on the newer schema, or data written by the
  failed release has to go, restore that dump (everything written since the
  backup is lost):
    sudo systemctl stop $SERVICE
    sudo -u postgres pg_restore --clean --if-exists -d pls_studio $DUMP
    sudo systemctl start $SERVICE
  This is not done automatically: a failed start is often unrelated to the
  database (no migration ran), and a restore discards whatever users saved
  since the backup, so it needs a person to decide.
  Logs: journalctl -u $SERVICE -n 200
HELP
}

roll_back() {
  if [ -z "$PREV_NAME" ]; then
    rollback_help
    die "$SERVICE is not healthy on :$PORT (log above) and there is no previous release to go back to."
  fi
  warn "$SERVICE is not healthy on :$PORT with ${NEW_SHA:0:7} (log above): switching back to $PREV_NAME"
  point_current "$PREV_NAME"
  restart_service
  if wait_healthy; then
    ok "Rolled back: $SERVICE runs $PREV_NAME again (${OLD_SHA:0:7}). The failed release stays in $RELEASES/$NEW_NAME."
    rollback_help
    die "Deploy of ${NEW_SHA:0:7} failed; rolled back to ${OLD_SHA:0:7}."
  fi
  rollback_help
  die "The previous release $PREV_NAME is not healthy either (log above). If a migration changed the schema, restore the dump as shown, then: sudo systemctl restart $SERVICE"
}

# Keep the newest KEEP_RELEASES releases; the live one and the one before it
# always stay.
prune_releases() {
  local n=0 name
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' -exec basename {} \; | sort -r \
    | while read -r name; do
      n=$((n + 1))
      if [ "$n" -le "$KEEP_RELEASES" ] || [ "$name" = "$NEW_NAME" ] || [ "$name" = "$PREV_NAME" ]; then
        continue
      fi
      log "Removing old release $name"
      rm -rf -- "${RELEASES:?}/$name"
    done
}

on_exit() {
  local status=$?
  if [ -n "${PARTIAL:-}" ] && [ -d "$PARTIAL" ]; then
    rm -rf -- "$PARTIAL"
    [ "$status" -eq 0 ] || printf '\033[1;31m[pls] ERROR:\033[0m %s\n' "Building ${NEW_SHA:0:7} failed (output above); it was removed and the site still runs ${OLD_SHA:0:7}." >&2
  fi
}

main() {
  require_root
  if ! [[ "$KEEP_RELEASES" =~ ^[0-9]+$ ]] || [ "$KEEP_RELEASES" -lt 2 ]; then
    die "KEEP_RELEASES must be a number, at least 2."
  fi
  [ -f "$ENV_FILE" ] || die "$ENV_FILE missing — run deploy/pls-provision.sh first."
  init_paths
  [ -d "$REPO" ] || [ -d "$APP_DIR/.git" ] || die "$APP_DIR has no repository — run deploy/pls-provision.sh first."
  take_lock

  PARTIAL=""
  NEW_SHA=""
  OLD_SHA=""
  trap on_exit EXIT

  if [ ! -L "$CURRENT" ] && [ -d "$APP_DIR/.git" ]; then
    migrate_old_layout
  fi
  as_app mkdir -p "$RELEASES"
  # Left over from an interrupted deploy (we hold the lock: none is running).
  find "$RELEASES" -mindepth 1 -maxdepth 1 -name '*.partial' -exec rm -rf {} +

  PREV_NAME="$(current_release)"
  if [ -n "$PREV_NAME" ]; then
    OLD_SHA="$(cat "$RELEASES/$PREV_NAME/REVISION")"
  fi

  # ── Fetch ──
  log "Fetching $BRANCH"
  as_app git -C "$REPO" fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  NEW_SHA="$(as_app git -C "$REPO" rev-parse --verify "refs/remotes/origin/$BRANCH^{commit}")"
  if [ "$OLD_SHA" = "$NEW_SHA" ]; then
    log "Already at ${NEW_SHA:0:7}; rebuilding anyway"
  else
    log "${OLD_SHA:0:7} -> ${NEW_SHA:0:7}"
  fi

  build_release
  backup_database

  # ── Switch, restart, health ──
  PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -1)"
  PORT="${PORT:-8787}"
  local origin
  origin="$(sed -n 's/^APP_ORIGIN=//p' "$ENV_FILE" | head -1)"
  use_current_paths
  point_current "$NEW_NAME"
  ok "current -> releases/$NEW_NAME"
  log "Restarting $SERVICE (migrations run on start)"
  restart_service
  wait_healthy || roll_back
  ok "$SERVICE healthy on 127.0.0.1:$PORT"

  remove_old_checkout
  link_deploy_dir
  prune_releases

  # Through Caddy too (catches TLS/proxy problems). Not fatal: on the very first
  # deploy Caddy is only reloaded after this script, by pls-provision.sh.
  if [ -n "$origin" ] && systemctl is-active --quiet caddy; then
    if curl -fsS --max-time 10 "$origin/api/health" >/dev/null 2>&1; then
      ok "$origin/api/health reachable"
    else
      log "Note: $origin/api/health not reachable yet (certificate pending, DNS, or Caddy not reloaded)."
    fi
  fi

  ok "PLS Studio ${NEW_SHA:0:7} deployed (release $NEW_NAME; previous: ${PREV_NAME:-none}). Users: hard refresh not needed (index.html is revalidated)."
}

# (Sourced by deploy/deploy.test.ts to run the steps against a scratch directory.)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
