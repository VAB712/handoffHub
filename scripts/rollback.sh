#!/usr/bin/env bash
# Put the server back on the commit recorded by the last deploy.
#
# Code only (keeps handoffs written after the backup):
#   bash /users/neo4j/handoff-app/handoffHub/scripts/rollback.sh
#
# Code plus the database and attachments from that backup.
# This deletes handoffs, comments, and files saved after the backup:
#   bash /users/neo4j/handoff-app/handoffHub/scripts/rollback.sh --restore-data
#
# After a rollback, the previous commit may not contain these scripts.
# A copy is kept in $HOME/handoff-backups/scripts/.
#
# Optional environment:
#   APP_DIR, BACKUP_DIR, PM2_APP_NAME, GIT_BRANCH
#   RESTORE_DATA_CONFIRM=yes   skip the YES prompt for --restore-data

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-common.sh
source "$SCRIPT_DIR/release-common.sh"

RESTORE_DATA=0
RELEASE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore-data)
      RESTORE_DATA=1
      shift
      ;;
    --release)
      [[ $# -ge 2 ]] || die "--release needs a path to release.env"
      RELEASE_FILE="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

APP_DIR="$(resolve_app_dir "$SCRIPT_DIR")"
BACKUP_ROOT="${BACKUP_DIR:-$HOME/handoff-backups}"
RELEASE_FILE="${RELEASE_FILE:-$BACKUP_ROOT/latest-release.env}"

on_exit() {
  local code=$?
  if [[ "$code" -ne 0 ]]; then
    printf 'Rollback did not finish. PM2 may be stopped. Backups were not deleted.\n' >&2
  fi
  release_lock
}
trap on_exit EXIT

[[ "$(id -u)" -ne 0 ]] || die "Run this as the neo4j user that owns PM2, not as root."
need_cmd git
need_cmd node
need_cmd npm
need_cmd npx
need_cmd pm2
need_cmd tar
[[ -f "$RELEASE_FILE" ]] || die "No release record at $RELEASE_FILE. Deploy first, or pass --release."

PREVIOUS_SHA="$(read_env_value PREVIOUS_SHA "$RELEASE_FILE")"
BACKUP_DUMP="$(read_env_value BACKUP_DUMP "$RELEASE_FILE")"
BACKUP_ATTACHMENTS="$(read_env_value BACKUP_ATTACHMENTS "$RELEASE_FILE")"
CREATED_AT="$(read_env_value CREATED_AT "$RELEASE_FILE")"
SAVED_APP_DIR="$(read_env_value APP_DIR "$RELEASE_FILE")"
SAVED_PM2="$(read_env_value PM2_APP_NAME "$RELEASE_FILE")"
SAVED_ATTACH="$(read_env_value ATTACH_ABS "$RELEASE_FILE")"

[[ -n "$PREVIOUS_SHA" ]] || die "Release record has no PREVIOUS_SHA: $RELEASE_FILE"
[[ -n "$SAVED_APP_DIR" ]] || die "Release record has no APP_DIR: $RELEASE_FILE"
APP_DIR="$SAVED_APP_DIR"
if [[ -z "${PM2_APP_NAME:-}" && -n "$SAVED_PM2" ]]; then
  PM2_APP_NAME="$SAVED_PM2"
fi

[[ -d "$APP_DIR" ]] || die "App directory does not exist: $APP_DIR"
mkdir -p "$BACKUP_ROOT"
acquire_lock
preserve_scripts
cd "$APP_DIR"
load_app_env
if [[ -n "$SAVED_ATTACH" ]]; then
  ATTACH_ABS="$SAVED_ATTACH"
fi
assert_safe_attachments_path
assert_clean_worktree
PM2_NAME="$(resolve_pm2_name)"

log "Rolling back $APP_DIR to commit $PREVIOUS_SHA"
log "PM2 process: $PM2_NAME"
if [[ "$RESTORE_DATA" == "1" ]]; then
  log "Database and attachments will be restored from the $CREATED_AT backup."
  log "Handoffs saved after that backup will be deleted."
  if [[ "${RESTORE_DATA_CONFIRM:-}" != "yes" ]]; then
    read -r -p "Type YES to continue: " answer
    [[ "$answer" == "YES" ]] || die "Restore cancelled."
  fi
  [[ -f "$BACKUP_DUMP" ]] || die "Database backup not found: $BACKUP_DUMP"
  need_cmd pg_restore
else
  log "Database and attachments stay as they are."
fi

stop_app

if [[ "$RESTORE_DATA" == "1" ]]; then
  if command -v psql >/dev/null 2>&1; then
    log "Closing other database sessions"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();" >/dev/null
  fi
  log "Restoring the database"
  pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$BACKUP_DUMP"
  if [[ -f "$BACKUP_ATTACHMENTS" ]]; then
    attach_name="$(basename "$ATTACH_ABS")"
    extract_dir="$(mktemp -d)"
    log "Restoring attachments into $ATTACH_ABS"
    tar -xzf "$BACKUP_ATTACHMENTS" -C "$extract_dir"
    [[ -d "$extract_dir/$attach_name" ]] || die "Backup archive does not contain $attach_name. Extracted copy: $extract_dir"
    rm -rf "$ATTACH_ABS"
    mkdir -p "$(dirname "$ATTACH_ABS")"
    mv "$extract_dir/$attach_name" "$ATTACH_ABS" || die "Could not move restored attachments into place. Extracted copy: $extract_dir/$attach_name"
    rm -rf "$extract_dir"
  else
    log "No attachments archive in this backup. Existing files were left in place."
  fi
fi

checkout_commit "$PREVIOUS_SHA"
RUN_MIGRATIONS=0 install_and_build
start_app
wait_until_online

log "Rollback finished on commit $(git rev-parse HEAD)."
if [[ "$RESTORE_DATA" != "1" ]]; then
  log "The database still has the new columns and any handoffs saved after the deploy."
fi
printf 'The next deploy can be started with:\n  bash %s/deploy.sh\n' "$BACKUP_ROOT/scripts"
