#!/usr/bin/env bash
# Deploys «Легко» to the VPS: uploads the committed HEAD, builds the image on the server,
# restarts the stack and checks https://fit.triple-a.dev/api/health.
#
# Run from anywhere inside the repo (Git Bash on Windows, or any bash ≥ 4):
#   deploy/deploy.sh [deploy] [--force]  build and roll out HEAD (--force: allow a dirty working tree)
#   deploy/deploy.sh rollback            switch back to the image that ran before the last deploy
#   deploy/deploy.sh logs [args…]        follow container logs (default: app); args go to `docker compose logs`
#   deploy/deploy.sh status              containers, health and deployed versions
#   deploy/deploy.sh set-password        set or rotate the app password (interactive)
#
# Environment (all optional):
#   DEPLOY_HOST      ssh target                    default deploy@64.176.75.160
#   DEPLOY_DIR       stack directory on the host   default /opt/training-app
#   PUBLIC_URL       origin for the smoke check    default https://fit.triple-a.dev
#   DEPLOY_SSH_OPTS  extra ssh options, e.g. "-i /c/Users/me/.ssh/vultr" (word-split, no quoting)
#   LOG_TAIL         lines of history for `logs`   default 200
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-deploy@64.176.75.160}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/training-app}"
PUBLIC_URL="${PUBLIC_URL:-https://fit.triple-a.dev}"
LOG_TAIL="${LOG_TAIL:-200}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_SCRIPT="${SCRIPT_DIR}/remote.sh"

SSH_OPTS=()
if [[ -n "${DEPLOY_SSH_OPTS:-}" ]]; then
  read -r -a SSH_OPTS <<<"${DEPLOY_SSH_OPTS}"
fi
SSH_OPTS+=(-o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=10)

if [[ -t 1 ]]; then
  C_BLUE=$'\033[1;34m' C_GREEN=$'\033[1;32m' C_YELLOW=$'\033[1;33m' C_RED=$'\033[1;31m' C_OFF=$'\033[0m'
else
  C_BLUE='' C_GREEN='' C_YELLOW='' C_RED='' C_OFF=''
fi

log() { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
ok() { printf '%s==>%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die() {
  printf '%serror:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2
  exit 1
}

# Prints the header comment of this file.
usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

require() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "'${tool}' is required but not installed"
  done
}

# Quotes arguments for the remote login shell.
quote() {
  local out='' arg
  for arg in "$@"; do
    out+="$(printf '%q' "$arg") "
  done
  printf '%s' "${out% }"
}

# ssh_host [ssh options…] <remote command string>
ssh_host() {
  local last=$(($# - 1))
  # MSYS_*: if a native Windows ssh.exe is picked up, keep /opt/… in the command untouched.
  # The remote command is assembled (and quoted) locally on purpose.
  # shellcheck disable=SC2029
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    ssh "${@:1:last}" "${SSH_OPTS[@]}" "$DEPLOY_HOST" "${!#}"
}

# Runs deploy/remote.sh on the server: remote <command> [args…]
remote() {
  [[ -f "$REMOTE_SCRIPT" ]] || die "missing ${REMOTE_SCRIPT}"
  # tr: tolerate a CRLF checkout on Windows.
  tr -d '\r' <"$REMOTE_SCRIPT" |
    ssh_host "bash -s -- $(quote "$DEPLOY_DIR" "$@")"
}

# Interactive command in the stack directory (allocates a TTY so Ctrl-C and prompts work).
remote_tty() {
  ssh_host -t "cd $(quote "$DEPLOY_DIR") && $*"
}

format_duration() {
  local s="$1"
  if ((s >= 60)); then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%ds' "$s"
  fi
}

# smoke_check [expected-version] — GET /api/health through Caddy from this machine.
smoke_check() {
  local expected="${1:-}" url="${PUBLIC_URL%/}/api/health" body='' attempt
  log "Smoke check ${url}"
  for attempt in 1 2 3 4 5 6; do
    if body="$(curl -fsS --max-time 10 "$url" 2>&1)"; then
      if [[ -z "$expected" ]] || grep -qF "\"version\":\"${expected}\"" <<<"$body"; then
        ok "Health: ${body}"
      else
        warn "health answers but reports another version (expected ${expected}): ${body}"
      fi
      return 0
    fi
    sleep 3
  done
  warn "smoke check failed after ${attempt} attempts: ${body}"
  return 1
}

cmd_deploy() {
  local force=0 arg
  for arg in "$@"; do
    case "$arg" in
      -f | --force) force=1 ;;
      *) die "unknown option for deploy: ${arg}" ;;
    esac
  done

  require git ssh curl tr
  local root
  root="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
  cd "$root"

  local file
  for file in Dockerfile deploy/compose.yaml deploy/Caddyfile deploy/remote.sh; do
    git cat-file -e "HEAD:${file}" 2>/dev/null || die "${file} is not committed — git archive HEAD would not include it"
  done

  if [[ -n "$(git status --porcelain)" ]]; then
    if ((force)); then
      warn "working tree is dirty — deploying the committed HEAD only; uncommitted changes are NOT included"
    else
      git status --short >&2
      die "working tree is dirty: commit or stash first (or pass --force to deploy HEAD anyway)"
    fi
  fi

  local sha subject started=$SECONDS
  sha="$(git rev-parse --short HEAD)"
  subject="$(git log -1 --format=%s HEAD)"
  log "Deploying ${sha} «${subject}» to ${DEPLOY_HOST}:${DEPLOY_DIR}"

  log "Uploading source (git archive HEAD → ${DEPLOY_DIR}/src.new)"
  git archive --format=tar HEAD |
    ssh_host -C "set -eu; cd $(quote "$DEPLOY_DIR"); rm -rf src.new; mkdir src.new; tar -xf - -C src.new" ||
    die "upload to ${DEPLOY_HOST}:${DEPLOY_DIR} failed"

  if ! remote deploy "$sha" "root@${DEPLOY_HOST#*@}"; then
    die "deploy of ${sha} failed on the server — see the [server] messages above"
  fi

  if ! smoke_check "$sha"; then
    die "${sha} runs and is healthy on the server, but ${PUBLIC_URL} did not answer from here — check DNS/Caddy (deploy/deploy.sh logs caddy)"
  fi

  printf '\n'
  ok "Deployed ${sha} «${subject}» in $(format_duration $((SECONDS - started)))"
  printf '    %s\n' "$PUBLIC_URL" "Rollback: deploy/deploy.sh rollback" "Logs:     deploy/deploy.sh logs"
}

cmd_rollback() {
  (($# == 0)) || die "rollback takes no arguments"
  require ssh curl tr
  local started=$SECONDS
  log "Rolling back ${DEPLOY_HOST}:${DEPLOY_DIR} to training-app:previous"
  remote rollback
  smoke_check || die "rollback finished on the server, but ${PUBLIC_URL} did not answer from here"
  ok "Rolled back in $(format_duration $((SECONDS - started)))"
}

cmd_logs() {
  require ssh
  local args=("$@")
  ((${#args[@]})) || args=(app)
  remote_tty "docker compose logs --tail=$(quote "$LOG_TAIL") --follow $(quote "${args[@]}")"
}

cmd_status() {
  (($# == 0)) || die "status takes no arguments"
  require ssh tr
  remote status
}

cmd_set_password() {
  (($# == 0)) || die "set-password takes no arguments"
  require ssh
  remote_tty "docker compose exec app node /app/server/cli.js set-password"
}

main() {
  local cmd=deploy
  # `deploy.sh` and `deploy.sh --force` mean `deploy.sh deploy [--force]`.
  if (($#)) && [[ "$1" != -f && "$1" != --force ]]; then
    cmd="$1"
    shift
  fi
  case "$cmd" in
    deploy) cmd_deploy "$@" ;;
    rollback) cmd_rollback "$@" ;;
    logs) cmd_logs "$@" ;;
    status) cmd_status "$@" ;;
    set-password) cmd_set_password "$@" ;;
    -h | --help | help) usage ;;
    *)
      usage >&2
      die "unknown command: ${cmd}"
      ;;
  esac
}

main "$@"
