#!/usr/bin/env bash
# PLS Studio — database backup (pg_dump custom format) with rotation.
#
#   sudo bash /opt/pls-studio/deploy/pls-backup.sh
#   cron (daily 03:30):  30 3 * * * root bash /opt/pls-studio/deploy/pls-backup.sh >/dev/null
#
# Datasets in the dump are encrypted with keys wrapped by DATA_MASTER_KEY
# (/etc/pls-studio/pls-studio.env). Restoring needs that key, so keep a copy
# of it — but NOT next to these dumps: dump + key together give the data away.
#
# Restore: sudo -u postgres pg_restore --clean --if-exists -d pls_studio FILE
#
# ENV
#   BACKUP_DIR   default /var/backups/pls-studio
#   KEEP         dumps to keep, default 14
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pls-studio}"
KEEP="${KEEP:-14}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "KEEP must be a positive number." >&2; exit 1; }

install -d -m 700 -o postgres -g postgres "$BACKUP_DIR"
FILE="$BACKUP_DIR/pls_studio-$(date -u +%Y%m%dT%H%M%SZ).dump"
sudo -u postgres pg_dump --format=custom --file="$FILE.part" pls_studio
mv "$FILE.part" "$FILE"
chmod 600 "$FILE"
echo "Wrote $FILE ($(du -h "$FILE" | cut -f1))"

# Keep the newest $KEEP dumps.
ls -1t "$BACKUP_DIR"/pls_studio-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
done
