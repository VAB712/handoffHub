# Shared helpers for scripts/deploy.sh and scripts/rollback.sh.
# This file is meant to be sourced, not executed.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "Source this file from deploy.sh or rollback.sh." >&2
  exit 1
fi

set -euo pipefail

DEFAULT_APP_DIR="/users/neo4j/handoff-app/handoffHub"
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-main}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

read_env_value() {
  local key="$1"
  local file="$2"
  local line value
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 && "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

resolve_app_dir() {
  local script_dir="$1"
  if [[ -n "${APP_DIR:-}" ]]; then
    printf '%s' "$APP_DIR"
    return
  fi
  if [[ -f "$script_dir/../package.json" ]]; then
    (cd "$script_dir/.." && pwd)
    return
  fi
  printf '%s' "$DEFAULT_APP_DIR"
}

load_app_env() {
  local env_file="$APP_DIR/.env"
  [[ -f "$env_file" ]] || die "Missing $env_file. The server .env is not replaced by these scripts."
  DATABASE_URL="$(read_env_value DATABASE_URL "$env_file")"
  [[ -n "$DATABASE_URL" ]] || die "DATABASE_URL is empty in $env_file"
  export DATABASE_URL

  local raw
  raw="$(read_env_value ATTACHMENTS_DIR "$env_file")"
  [[ -n "$raw" ]] || raw="data/attachments"
  if [[ "$raw" == /* ]]; then
    ATTACH_ABS="$raw"
  else
    ATTACH_ABS="$APP_DIR/$raw"
  fi
}

assert_safe_attachments_path() {
  [[ -n "${ATTACH_ABS:-}" ]] || die "Attachments path is empty."
  [[ "$ATTACH_ABS" == /* ]] || die "Attachments path must be absolute: $ATTACH_ABS"
  case "$ATTACH_ABS" in
    /|/home|/users|/users/neo4j|"$APP_DIR"|"$HOME")
      die "Refusing to use attachments path: $ATTACH_ABS"
      ;;
  esac
}

assert_clean_worktree() {
  local dirty
  dirty="$(git status --porcelain --untracked-files=no)"
  [[ -z "$dirty" ]] || die "Tracked files on the server have local changes. Commit or discard them before running this script."
}

preserve_scripts() {
  local dest="$BACKUP_ROOT/scripts"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/rollback.sh" "$SCRIPT_DIR/release-common.sh" "$dest/"
  chmod 755 "$dest/deploy.sh" "$dest/rollback.sh" "$dest/release-common.sh"
}

acquire_lock() {
  LOCK_DIR="$BACKUP_ROOT/.lock"
  if [[ -d "$LOCK_DIR" ]]; then
    local oldpid=""
    [[ -f "$LOCK_DIR/pid" ]] && oldpid="$(cat "$LOCK_DIR/pid")"
    if [[ -n "$oldpid" ]] && kill -0 "$oldpid" 2>/dev/null; then
      die "A deploy or rollback is already running (pid $oldpid)."
    fi
    rm -rf "$LOCK_DIR"
  fi
  mkdir "$LOCK_DIR"
  echo "$$" > "$LOCK_DIR/pid"
}

release_lock() {
  [[ -n "${LOCK_DIR:-}" ]] || return 0
  rm -rf "$LOCK_DIR"
}

pm2_jlist_query() {
  local mode="$1"
  pm2 jlist | node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const mode = process.argv[1];
      const name = process.argv[2];
      const cwd = process.argv[3];
      let list = [];
      try { list = JSON.parse(raw); } catch { process.stdout.write(""); return; }
      if (mode === "status") {
        const proc = list.find((item) => item.name === name);
        process.stdout.write(proc && proc.pm2_env ? proc.pm2_env.status : "missing");
        return;
      }
      const hits = list.filter((item) => item.pm2_env && item.pm2_env.pm_cwd === cwd);
      if (hits.length === 0) return;
      const preferred = hits.find((item) => item.name === "handoffHub") || hits[0];
      process.stdout.write(preferred.name);
    });
  ' "$mode" "${PM2_APP_NAME:-}" "$APP_DIR"
}

resolve_pm2_name() {
  if [[ -n "${PM2_APP_NAME:-}" ]]; then
    printf '%s' "$PM2_APP_NAME"
    return
  fi
  local detected
  detected="$(pm2_jlist_query detect)"
  if [[ -n "$detected" ]]; then
    printf '%s' "$detected"
    return
  fi
  printf '%s' "handoffHub"
}

stop_app() {
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    log "Stopping PM2 process $PM2_NAME"
    pm2 stop "$PM2_NAME"
  else
    log "PM2 process $PM2_NAME is not registered yet."
  fi
}

start_app() {
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    log "Restarting PM2 process $PM2_NAME"
    pm2 restart "$PM2_NAME" --update-env || return 1
  else
    log "Starting PM2 process $PM2_NAME"
    pm2 start npm --name "$PM2_NAME" --cwd "$APP_DIR" -- start || return 1
  fi
  pm2 save || log "pm2 save failed. The process is running, but a reboot may not restore it until pm2 save succeeds."
}

wait_until_online() {
  local status="" attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    status="$(pm2_jlist_query status)"
    if [[ "$status" == "online" ]]; then
      log "PM2 process $PM2_NAME is online."
      return 0
    fi
    sleep 1
  done
  log "PM2 process $PM2_NAME status is ${status:-unknown}."
  pm2 describe "$PM2_NAME" || true
  return 1
}

install_and_build() {
  log "Installing dependencies from package-lock.json"
  npm ci --include=dev || return 1
  log "Generating Prisma client"
  npx prisma generate || return 1
  if [[ "${RUN_MIGRATIONS:-0}" == "1" ]]; then
    log "Applying Prisma migrations"
    npx prisma migrate deploy || return 1
  fi
  log "Building the production app"
  npm run build || return 1
}

checkout_commit() {
  local sha="$1"
  [[ "$sha" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "Refusing to check out unexpected commit id: $sha"
  git cat-file -t "$sha" >/dev/null 2>&1 || die "Commit $sha is not in this clone."
  log "Checking out commit $sha on $GIT_BRANCH"
  git checkout "$GIT_BRANCH" || return 1
  git reset --hard "$sha" || return 1
}
