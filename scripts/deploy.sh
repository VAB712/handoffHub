#!/usr/bin/env bash
# Deploy the current origin/main checkout on the Linux server.
#
# Run as the same user that owns the PM2 process (neo4j), from any directory:
#   bash /users/neo4j/handoff-app/handoffHub/scripts/deploy.sh
#
# Optional environment:
#   APP_DIR          app directory (default: this repo, or /users/neo4j/handoff-app/handoffHub)
#   BACKUP_DIR       backup root (default: $HOME/handoff-backups)
#   PM2_APP_NAME     PM2 process name (default: process whose cwd is the app, else handoffHub)
#   GIT_BRANCH       branch to fast-forward (default: main)
#
# The script stops the app, backs up Postgres and attachments, records the
# current commit, pulls, migrates, builds, and starts PM2. It does not run
# the database seed and it does not modify .env.
# If a step fails after the pull, it puts the previous commit back and starts
# that build. The database backup is not restored automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-common.sh
source "$SCRIPT_DIR/release-common.sh"

APP_DIR="$(resolve_app_dir "$SCRIPT_DIR")"
BACKUP_ROOT="${BACKUP_DIR:-$HOME/handoff-backups}"
phase="precheck"
PREVIOUS_SHA=""
RELEASE_DIR=""

on_exit() {
  local code=$?
  if [[ "$code" -ne 0 && "${IN_ROLLBACK:-0}" != "1" ]]; then
    IN_ROLLBACK=1
    printf '\nDeploy failed during: %s\n' "$phase" >&2
    case "$phase" in
      stopped|backed_up)
        log "Starting the existing app again."
        start_app || true
        ;;
      updated|migrated|built)
        log "Restoring the previous commit and starting that version. The database backup is kept and not restored."
        if [[ -n "$PREVIOUS_SHA" ]]; then
          set +e
          checkout_commit "$PREVIOUS_SHA"
          local checkout_code=$?
          local build_code=1
          local start_code=1
          if [[ "$checkout_code" -eq 0 ]]; then
            RUN_MIGRATIONS=0 install_and_build
            build_code=$?
          fi
          if [[ "$build_code" -eq 0 ]]; then
            start_app
            start_code=$?
          fi
          set -e
          if [[ "$checkout_code" -ne 0 || "$build_code" -ne 0 || "$start_code" -ne 0 ]]; then
            printf 'Automatic code rollback did not finish. The app may be stopped. Run:\n  bash %s/rollback.sh\n' "$BACKUP_ROOT/scripts" >&2
          else
            log "Previous version is running again ($PREVIOUS_SHA)."
          fi
        fi
        ;;
    esac
    if [[ -n "$RELEASE_DIR" ]]; then
      printf 'Backup directory: %s\n' "$RELEASE_DIR" >&2
    fi
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
need_cmd pg_dump
need_cmd tar

[[ -d "$APP_DIR" ]] || die "App directory does not exist: $APP_DIR"
[[ -f "$APP_DIR/package.json" ]] || die "package.json not found in $APP_DIR"

mkdir -p "$BACKUP_ROOT"
acquire_lock
cd "$APP_DIR"
load_app_env
assert_safe_attachments_path
PM2_NAME="$(resolve_pm2_name)"

log "App directory: $APP_DIR"
log "PM2 process: $PM2_NAME"
log "Backup root: $BACKUP_ROOT"

assert_clean_worktree
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP_DIR is not a git checkout."

stamp="$(date '+%Y%m%d-%H%M%S')"
RELEASE_DIR="$BACKUP_ROOT/$stamp"
mkdir -p "$RELEASE_DIR"
preserve_scripts

phase="stopped"
stop_app

phase="backed_up"
PREVIOUS_SHA="$(git rev-parse HEAD)"
log "Current commit: $PREVIOUS_SHA"
log "Writing database backup"
pg_dump --format=custom --no-owner --no-privileges --file="$RELEASE_DIR/db.dump" --dbname="$DATABASE_URL"
if [[ -d "$ATTACH_ABS" ]]; then
  log "Writing attachments backup from $ATTACH_ABS"
  tar -czf "$RELEASE_DIR/attachments.tar.gz" -C "$(dirname "$ATTACH_ABS")" "$(basename "$ATTACH_ABS")"
else
  log "No attachments directory at $ATTACH_ABS. Skipping the file backup."
  : > "$RELEASE_DIR/attachments.tar.gz.missing"
fi
cp "$APP_DIR/.env" "$RELEASE_DIR/env.bak"
chmod 600 "$RELEASE_DIR/env.bak" "$RELEASE_DIR/db.dump"

cat > "$RELEASE_DIR/release.env" <<EOF
PREVIOUS_SHA=$PREVIOUS_SHA
BACKUP_DUMP=$RELEASE_DIR/db.dump
BACKUP_ATTACHMENTS=$RELEASE_DIR/attachments.tar.gz
CREATED_AT=$stamp
APP_DIR=$APP_DIR
PM2_APP_NAME=$PM2_NAME
ATTACH_ABS=$ATTACH_ABS
EOF
cp "$RELEASE_DIR/release.env" "$BACKUP_ROOT/latest-release.env"
chmod 600 "$RELEASE_DIR/release.env" "$BACKUP_ROOT/latest-release.env"

log "Fetching $GIT_REMOTE/$GIT_BRANCH"
git fetch "$GIT_REMOTE" "$GIT_BRANCH"
git checkout "$GIT_BRANCH"
git pull --ff-only "$GIT_REMOTE" "$GIT_BRANCH"
phase="updated"
preserve_scripts

RUN_MIGRATIONS=1 install_and_build
phase="built"

start_app
wait_until_online
phase="started"

log "Deploy finished."
log "Running commit: $(git rev-parse HEAD)"
log "Backup: $RELEASE_DIR"
printf '\nIf the new version misbehaves, restore the previous code with:\n  bash %s/rollback.sh\n\n' "$SCRIPT_DIR"
printf 'That keeps the database. To also put the database and attachments back to this backup, run:\n  bash %s/rollback.sh --restore-data\n' "$SCRIPT_DIR"
