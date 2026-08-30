#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
compose_file="$repo_root/docker-compose.yml"
portable_compose_file="$repo_root/docker-compose.portable.yml"

action="Status"
component_arg="all"
data_root="${OPENSHORTS_DATA_ROOT:-$repo_root/.local-data}"
positional_action=0
positional_component=0
action_provided=0
component_provided=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/manage-local.sh [--action ACTION] [--component COMPONENTS] [--data-root PATH]
  ./scripts/manage-local.sh ACTION [COMPONENTS]

Actions:
  Update    Build the selected Docker services.
  Start     Start the selected services in the background.
  Stop      Stop the selected services and preserve volumes.
  Restart   Stop, build, and start the selected services.
  Status    Show the selected service status (default).

Options:
  --action ACTION          One of Update, Start, Stop, Restart, Status.
  --component COMPONENTS  Comma-separated: all, db, backend, frontend, renderer.
  --data-root PATH         Persistent data directory (default: .local-data).
  -h, --help               Show this help text.

The portable renderer runs in Docker using CPU/software rendering. The
Windows-native AMD renderer remains available through manage-local.ps1.
EOF
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_option_value() {
  local option="$1"
  if [[ $# -lt 2 || -z "${2:-}" ]]; then
    die "Option '$option' requires a value."
  fi
}

assign_positional() {
  local value="$1"
  if [[ "$action_provided" -eq 0 && "$positional_action" -eq 0 ]]; then
    action="$value"
    positional_action=1
  elif [[ "$component_provided" -eq 0 && "$positional_component" -eq 0 ]]; then
    component_arg="$value"
    positional_component=1
  else
    die "Unexpected argument '$value'."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -a|--action)
      require_option_value "$@"
      action="$2"
      action_provided=1
      shift 2
      ;;
    --action=*)
      action="${1#*=}"
      [[ -n "$action" ]] || die "Option '--action' requires a value."
      action_provided=1
      shift
      ;;
    -c|--component)
      require_option_value "$@"
      component_arg="$2"
      component_provided=1
      shift 2
      ;;
    --component=*)
      component_arg="${1#*=}"
      [[ -n "$component_arg" ]] || die "Option '--component' requires a value."
      component_provided=1
      shift
      ;;
    --data-root)
      require_option_value "$@"
      data_root="$2"
      shift 2
      ;;
    --data-root=*)
      data_root="${1#*=}"
      [[ -n "$data_root" ]] || die "Option '--data-root' requires a value."
      shift
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        assign_positional "$1"
        shift
      done
      ;;
    -*)
      die "Unknown option '$1'."
      ;;
    *)
      assign_positional "$1"
      shift
      ;;
  esac
done

case "${action,,}" in
  update) action="Update" ;;
  start) action="Start" ;;
  stop) action="Stop" ;;
  restart) action="Restart" ;;
  status) action="Status" ;;
  *) die "Unknown action '$action'. Allowed values: Update, Start, Stop, Restart, Status." ;;
esac

[[ -f "$compose_file" ]] || die "Compose file not found: $compose_file"
[[ -f "$portable_compose_file" ]] || die "Portable Compose file not found: $portable_compose_file"
command -v docker >/dev/null 2>&1 || die "Required command 'docker' was not found in PATH."
docker compose version >/dev/null 2>&1 || die "Docker Compose is not available. Install Docker Compose v2 and try again."

declare -a requested_components=()
IFS=',' read -r -a requested_components <<< "$component_arg"

has_all=0
needs_db=0
needs_backend=0
needs_frontend=0
needs_renderer=0

for requested in "${requested_components[@]}"; do
  component="${requested//[[:space:]]/}"
  [[ -n "$component" ]] || die "Component list contains an empty value."
  component="${component,,}"
  case "$component" in
    all)
      has_all=1
      ;;
    db)
      needs_db=1
      ;;
    backend)
      needs_backend=1
      ;;
    frontend)
      needs_frontend=1
      ;;
    renderer)
      needs_backend=1
      needs_renderer=1
      ;;
    native-renderer)
      die "'native-renderer' is Windows-only. Use scripts/manage-local.ps1 for the native AMD renderer."
      ;;
    *)
      die "Unknown component '$component'. Allowed values: all, db, backend, frontend, renderer."
      ;;
  esac
done

if [[ "$has_all" -eq 1 ]]; then
  if [[ "$needs_db" -eq 1 || "$needs_backend" -eq 1 || "$needs_frontend" -eq 1 || "$needs_renderer" -eq 1 ]]; then
    die "Use 'all' by itself or specify individual components."
  fi
  needs_db=1
  needs_backend=1
  needs_frontend=1
  needs_renderer=1
fi

declare -a compose_services=()
[[ "$needs_db" -eq 1 ]] && compose_services+=(db)
[[ "$needs_backend" -eq 1 ]] && compose_services+=(backend)
[[ "$needs_frontend" -eq 1 ]] && compose_services+=(frontend)
[[ "$needs_renderer" -eq 1 ]] && compose_services+=(renderer)

[[ "${#compose_services[@]}" -gt 0 ]] || die "At least one component must be selected."

export OPENSHORTS_DATA_ROOT="$data_root"
if [[ "$needs_renderer" -eq 1 ]]; then
  export RENDER_SERVICE_URL="http://renderer:3100"
  export VITE_RENDERER_PROXY_TARGET="http://renderer:3100"
fi

compose() {
  docker compose \
    --project-directory "$repo_root" \
    --file "$compose_file" \
    --file "$portable_compose_file" \
    "$@"
}

update_components() {
  local build_service
  declare -a build_services=()
  for build_service in "${compose_services[@]}"; do
    case "$build_service" in
      backend|frontend|renderer)
        build_services+=("$build_service")
        ;;
    esac
  done

  if [[ "${#build_services[@]}" -gt 0 ]]; then
    printf 'Building selected services: %s\n' "${build_services[*]}"
    compose build "${build_services[@]}"
  else
    printf 'No buildable services selected; database uses its configured image.\n'
  fi
  printf 'Selected components are up to date: %s\n' "${compose_services[*]}"
}

ensure_data_directories() {
  mkdir -p "$data_root/postgres" "$data_root/workdir"
}

wait_for_renderer_from_backend() {
  local deadline=$((SECONDS + 90))
  local health_check='import urllib.request; urllib.request.urlopen("http://renderer:3100/health", timeout=2)'

  while (( SECONDS < deadline )); do
    if compose exec -T backend python -c "$health_check" >/dev/null 2>&1; then
      printf 'Portable renderer is healthy on http://renderer:3100.\n'
      return 0
    fi
    sleep 1
  done

  die "Portable renderer did not become healthy within 90 seconds. Run '$0 Status --component renderer' for details."
}

start_components() {
  ensure_data_directories
  printf 'Starting selected services: %s\n' "${compose_services[*]}"
  compose up -d --force-recreate --remove-orphans "${compose_services[@]}"
  if [[ "$needs_renderer" -eq 1 ]]; then
    wait_for_renderer_from_backend
  fi
  printf 'Selected components are running: %s\n' "${compose_services[*]}"
}

stop_components() {
  printf 'Stopping selected services: %s\n' "${compose_services[*]}"
  compose stop "${compose_services[@]}"
  printf 'Selected components are stopped. Docker volumes were preserved.\n'
}

show_status() {
  compose ps "${compose_services[@]}"
}

case "$action" in
  Update)
    update_components
    ;;
  Start)
    start_components
    ;;
  Stop)
    stop_components
    ;;
  Restart)
    stop_components
    update_components
    start_components
    ;;
  Status)
    show_status
    ;;
esac
