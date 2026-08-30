#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/bin"
cat > "$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then
  exit 0
fi

printf 'RENDER_SERVICE_URL=%s\n' "${RENDER_SERVICE_URL:-}" >> "${FAKE_DOCKER_LOG:?}"
printf 'VITE_RENDERER_PROXY_TARGET=%s\n' "${VITE_RENDERER_PROXY_TARGET:-}" >> "${FAKE_DOCKER_LOG:?}"
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"
EOF
chmod +x "$test_root/bin/docker"

export FAKE_DOCKER_LOG="$test_root/docker.log"
export PATH="$test_root/bin:$PATH"

assert_contains() {
  local needle="$1"
  local file="$2"
  if ! grep -Fq -- "$needle" "$file"; then
    printf 'Expected %q in %s\n' "$needle" "$file" >&2
    exit 1
  fi
}

help_output="$test_root/help.txt"
bash "$repo_root/scripts/manage-local.sh" --help > "$help_output"
assert_contains '--action ACTION' "$help_output"
assert_contains '--data-root PATH' "$help_output"

if bash "$repo_root/scripts/manage-local.sh" --action Nope > /dev/null 2>&1; then
  echo 'invalid action was accepted' >&2
  exit 1
fi

if bash "$repo_root/scripts/manage-local.sh" --action Status --component native-renderer > /dev/null 2>&1; then
  echo 'native-renderer was accepted by the portable manager' >&2
  exit 1
fi

bash "$repo_root/scripts/manage-local.sh" --action Status --component db
assert_contains 'ps db' "$FAKE_DOCKER_LOG"
assert_contains 'docker-compose.portable.yml' "$FAKE_DOCKER_LOG"

bash "$repo_root/scripts/manage-local.sh" --action Status db
assert_contains 'ps db' "$FAKE_DOCKER_LOG"

bash "$repo_root/scripts/manage-local.sh" --action Status --component all
assert_contains 'ps db backend frontend renderer' "$FAKE_DOCKER_LOG"

bash "$repo_root/scripts/manage-local.sh" --action Start --component renderer --data-root "$test_root/data"
assert_contains 'up -d --force-recreate --remove-orphans backend renderer' "$FAKE_DOCKER_LOG"
assert_contains 'RENDER_SERVICE_URL=http://renderer:3100' "$FAKE_DOCKER_LOG"
assert_contains 'VITE_RENDERER_PROXY_TARGET=http://renderer:3100' "$FAKE_DOCKER_LOG"

printf 'manage-local.sh parser tests passed\n'
