#!/usr/bin/env bash
# Server half of deploy/deploy.sh. It is streamed over ssh and runs on the VPS as `deploy`:
#   ssh deploy@host 'bash -s -- <stack-dir> <command> [args…]' < deploy/remote.sh
# Commands:
#   deploy <version> [root-ssh-hint]  install ./src.new as ./src, build, restart, wait for health
#   rollback                          retag training-app:previous as :latest and restart the app
#   status                            containers, health, image versions, recent deploys
#
# Everything lives in functions and `main` is the last line: bash reads the script from stdin,
# so it must be fully read before any command runs (a child reading stdin would eat the rest).
set -euo pipefail

readonly IMAGE=training-app
readonly APP_UID=1000
readonly APP_GID=1000
readonly HEALTH_TIMEOUT=120
STACK_DIR=''

log() { printf '  [server] %s\n' "$*"; }
die() {
  printf '  [server] error: %s\n' "$*" >&2
  exit 1
}

# One deploy/rollback at a time.
lock() {
  exec 9>"${STACK_DIR}/.deploy.lock"
  flock -n 9 || die "another deploy or rollback is running"
}

# Container id of the app service (running or not); empty when there is none.
app_container() {
  docker compose ps --all --quiet app 2>/dev/null || true
}

image_version() {
  docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$1" 2>/dev/null || true
}

show_failure() {
  printf '\n' >&2
  log "---- docker compose ps ----"
  docker compose ps --all >&2 || true
  log "---- last app logs ----"
  docker compose logs --no-color --tail=120 app >&2 || true
}

# Waits until the app container reports healthy; fails early on a crash loop.
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) id state status restarts
  log "waiting for the app to become healthy (up to ${HEALTH_TIMEOUT}s)"
  while :; do
    id="$(app_container)"
    if [[ -n "$id" ]]; then
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$id" 2>/dev/null || echo 'missing 0')"
      read -r status restarts <<<"$state"
      case "$status" in
        healthy)
          log "app is healthy"
          return 0
          ;;
        unhealthy)
          log "app reports unhealthy"
          return 1
          ;;
        none)
          log "the image has no healthcheck"
          return 1
          ;;
      esac
      if ((restarts > 0)); then
        log "app restarted ${restarts} time(s) — crash loop"
        return 1
      fi
    fi
    if ((SECONDS >= deadline)); then
      log "timed out after ${HEALTH_TIMEOUT}s"
      return 1
    fi
    sleep 2
  done
}

# Is ./data writable by the app user (uid/gid 1000)?
data_writable_by_app() {
  local uid gid mode
  read -r uid gid mode <<<"$(stat -c '%u %g %a' data)"
  mode=$((8#$mode))
  if ((uid == APP_UID)); then
    (((mode & 8#300) == 8#300))
  elif ((gid == APP_GID)); then
    (((mode & 8#030) == 8#030))
  else
    (((mode & 8#003) == 8#003))
  fi
}

ensure_data_dir() {
  local root_hint="$1"
  mkdir -p data
  if ! data_writable_by_app; then
    die "${STACK_DIR}/data is not writable by uid ${APP_UID} (the app user). Fix it once as root:
    ssh ${root_hint} 'chown -R ${APP_UID}:${APP_GID} ${STACK_DIR}/data && chmod 700 ${STACK_DIR}/data'
  then run the deploy again."
  fi
}

# Copies a file from the uploaded source over its live copy, keeping <name>.bak.
# Writes in place (same inode) so single-file bind mounts of running containers see the change.
# Sets INSTALLED=1 when the content differed.
INSTALLED=0
install_file() {
  local src="$1" dst="$2"
  INSTALLED=0
  [[ -f "$src" ]] || die "${src} is missing from the uploaded source"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    return 0
  fi
  if [[ -s "$dst" ]]; then
    cp -p "$dst" "${dst}.bak"
  fi
  cat "$src" >"$dst"
  INSTALLED=1
}

# Keeps the image of the running app as :previous for `rollback` — only while it is healthy,
# so a redeploy after a failed deploy does not overwrite the last good image.
tag_previous() {
  local id image='' health
  id="$(app_container)"
  if [[ -n "$id" ]]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)"
    if [[ "$health" != healthy ]]; then
      log "the running app is not healthy (${health:-unknown}) — keeping the existing ${IMAGE}:previous"
      return 0
    fi
    image="$(docker inspect --format '{{.Image}}' "$id")"
  elif docker image inspect "${IMAGE}:latest" >/dev/null 2>&1; then
    image="${IMAGE}:latest"
  fi
  if [[ -z "$image" ]]; then
    log "no current app image (first deploy) — nothing to keep for rollback"
    return 0
  fi
  docker image tag "$image" "${IMAGE}:previous"
  log "kept the current image as ${IMAGE}:previous ($(image_version "${IMAGE}:previous"))"
}

swap_source() {
  [[ -f src.new/Dockerfile ]] || die "src.new/ is missing or incomplete — upload the source first (deploy.sh does this)"
  rm -rf src.old
  if [[ -d src ]]; then
    mv src src.old
  fi
  mv src.new src
  rm -rf src.old
}

validate_caddyfile() {
  local out
  # A bind-mount source that does not exist would be created as a directory.
  [[ -e Caddyfile ]] || : >Caddyfile
  if ! out="$(docker compose run --rm --no-deps -T caddy \
    caddy validate --config /dev/stdin --adapter caddyfile <src/deploy/Caddyfile 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "the new Caddyfile is invalid — nothing was restarted"
  fi
}

reload_caddy() {
  local out
  if out="$(docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)"; then
    log "caddy loaded the new Caddyfile (previous file: Caddyfile.bak)"
  else
    printf '%s\n' "$out" >&2
    die "caddy rejected the new Caddyfile and keeps serving the old config (previous file: Caddyfile.bak)"
  fi
}

# The shared edge: the external `edge` network (Caddy reaches other projects' containers through it)
# and /opt/caddy-sites with their site files (imported at the end of the Caddyfile).
ensure_edge() {
  local root_hint="$1"
  if ! docker network inspect edge >/dev/null 2>&1; then
    docker network create edge >/dev/null
    log "created the shared docker network 'edge'"
  fi
  [[ -d /opt/caddy-sites ]] || die "/opt/caddy-sites is missing. Create it once as root:
    ssh ${root_hint} 'install -d -m 755 -o deploy -g deploy /opt/caddy-sites'
  then run the deploy again."
}

prune() {
  docker image prune --force >/dev/null 2>&1 || true
  docker builder prune --force --filter until=336h >/dev/null 2>&1 || true
}

cmd_deploy() {
  local version="${1:?version required}" root_hint="${2:-root@<server>}"
  lock

  log "installing the uploaded source as ./src"
  swap_source

  docker compose --file src/deploy/compose.yaml --project-directory . config --quiet ||
    die "the new compose.yaml is invalid — nothing was changed"
  install_file src/deploy/compose.yaml compose.yaml
  if ((INSTALLED)); then
    log "compose.yaml updated (old one saved as compose.yaml.bak)"
  fi

  ensure_edge "$root_hint"

  # Validated now, installed only once the new app is healthy, so a failed deploy leaves Caddy alone.
  local caddy_changed=0
  if ! cmp -s src/deploy/Caddyfile Caddyfile; then
    validate_caddyfile
    caddy_changed=1
  fi

  ensure_data_dir "$root_hint"
  tag_previous

  log "building ${IMAGE}:latest (${version}) — this takes a few minutes on 1 vCPU"
  docker compose build --pull --build-arg "APP_VERSION=${version}" app

  log "starting the stack"
  if ! docker compose up --detach --remove-orphans; then
    show_failure
    die "docker compose up failed — fix and redeploy, or run: deploy/deploy.sh rollback"
  fi
  if ! wait_healthy; then
    show_failure
    die "the new version is not healthy — run: deploy/deploy.sh rollback"
  fi

  if ((caddy_changed)); then
    install_file src/deploy/Caddyfile Caddyfile
    reload_caddy
  fi

  printf '%s deploy %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$version" >>deploys.log
  prune
  log "running ${IMAGE}:latest ($(image_version "${IMAGE}:latest"))"
}

cmd_rollback() {
  lock
  docker image inspect "${IMAGE}:previous" >/dev/null 2>&1 ||
    die "there is no ${IMAGE}:previous image to roll back to"

  local previous current='' id
  previous="$(docker image inspect --format '{{.Id}}' "${IMAGE}:previous")"
  id="$(app_container)"
  if [[ -n "$id" ]]; then
    current="$(docker inspect --format '{{.Image}}' "$id")"
  fi
  [[ "$previous" != "$current" ]] || die "${IMAGE}:previous is already the running image"

  log "switching ${IMAGE}:latest to the previous image ($(image_version "${IMAGE}:previous"))"
  docker image tag "${IMAGE}:previous" "${IMAGE}:latest"
  docker compose up --detach --no-build --force-recreate app
  if ! wait_healthy; then
    show_failure
    die "the previous image is not healthy either"
  fi
  # Make sure Caddy runs as well (no-op when it already does).
  docker compose up --detach --no-build

  printf '%s rollback %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(image_version "${IMAGE}:latest")" >>deploys.log
  log "running ${IMAGE}:latest ($(image_version "${IMAGE}:latest"))"
}

cmd_status() {
  docker compose ps --all
  printf '\n'
  local tag
  for tag in latest previous; do
    if docker image inspect "${IMAGE}:${tag}" >/dev/null 2>&1; then
      printf '%s:%-9s %-10s built %s\n' "$IMAGE" "$tag" "$(image_version "${IMAGE}:${tag}")" \
        "$(docker image inspect --format '{{.Created}}' "${IMAGE}:${tag}" | cut -c1-19)"
    fi
  done
  if [[ -f deploys.log ]]; then
    printf '\nrecent deploys (UTC):\n'
    tail -n 5 deploys.log
  fi
}

main() {
  exec </dev/null
  if (($# < 2)); then
    echo "usage: remote.sh <stack-dir> <deploy|rollback|status> [args…]" >&2
    exit 2
  fi
  STACK_DIR="$1"
  local command="$2"
  shift 2

  cd "$STACK_DIR" || die "stack directory ${STACK_DIR} does not exist"
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available for $(id -un)"

  case "$command" in
    deploy) cmd_deploy "$@" ;;
    rollback) cmd_rollback ;;
    status) cmd_status ;;
    *) die "unknown command: ${command}" ;;
  esac
}

main "$@"
