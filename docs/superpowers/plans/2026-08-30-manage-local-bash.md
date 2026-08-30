# Cross-Platform Bash Local Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bash-based local lifecycle manager that works from Linux, macOS, WSL, and Git Bash using Docker Compose and a portable renderer container.

**Architecture:** Add a Bash CLI that resolves the repository root, validates actions/components, expands component dependencies, and invokes Docker Compose. Add a Compose override that enables the renderer container, routes traffic to it when selected, and replaces the Windows-specific data paths with a configurable portable data root. Keep the existing PowerShell native AMD workflow unchanged.

**Tech Stack:** Bash, Docker Compose, YAML, shell-level integration tests with a fake Docker executable.

---

### Task 1: Define parser and command-delegation behavior with shell tests

**Files:**
- Create: `tests/test-manage-local.sh`

- [x] **Step 1: Write the failing test**

Create a Bash test harness that prepends a temporary fake `docker` executable to
`PATH`, then checks help output, invalid input rejection, and the exact Compose
arguments for a valid status command:

```bash
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
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"
EOF
chmod +x "$test_root/bin/docker"
export FAKE_DOCKER_LOG="$test_root/docker.log"
export PATH="$test_root/bin:$PATH"

help_output="$test_root/help.txt"
bash "$repo_root/scripts/manage-local.sh" --help > "$help_output"
grep -q -- '--action' "$help_output"

if bash "$repo_root/scripts/manage-local.sh" --action Nope > /dev/null 2>&1; then
  echo 'invalid action was accepted' >&2
  exit 1
fi

bash "$repo_root/scripts/manage-local.sh" --action Status --component db
grep -q -- 'compose --project-directory' "$FAKE_DOCKER_LOG"
grep -q -- '--file' "$FAKE_DOCKER_LOG"
grep -q -- 'ps db' "$FAKE_DOCKER_LOG"
printf 'manage-local.sh parser tests passed\n'
```

- [x] **Step 2: Run test to verify it fails**

Run: `bash tests/test-manage-local.sh`

Expected: FAIL because `scripts/manage-local.sh` does not exist yet.

### Task 2: Add the portable Compose configuration

**Files:**
- Create: `docker-compose.portable.yml`

- [x] **Step 1: Define portable service overrides**

Add overrides for the `db` and `backend` data mounts, the backend renderer URL,
the frontend renderer proxy, and a `renderer` service built from
`render-service/Dockerfile`. The renderer must use `backend:8000` for metrics,
port `3100` inside the Compose network, and a configurable
`${OPENSHORTS_DATA_ROOT:-./.local-data}/workdir` output mount.

- [x] **Step 2: Validate the Compose model**

Run: `docker compose --project-directory . --file docker-compose.yml --file docker-compose.portable.yml config`

Expected: exit 0 with services `db`, `backend`, `frontend`, and `renderer`, and
no `D:/openshorts-docker-data` volume paths in the rendered portable config.

### Task 3: Implement the Bash lifecycle manager

**Files:**
- Create: `scripts/manage-local.sh`

- [x] **Step 1: Implement validation and root resolution**

Use `set -euo pipefail`, resolve `repo_root` from `BASH_SOURCE[0]`, validate the
Compose files and Docker/Docker Compose availability, and parse `--action`,
`--component`, `--data-root`, `--help`, plus positional action/component forms.

- [x] **Step 2: Implement component expansion**

Accept `all`, `db`, `backend`, `frontend`, and `renderer`. Expand `all` to all
four services and expand `renderer` to include `backend`. Reject
`native-renderer` with a message directing users to the PowerShell workflow.

- [x] **Step 3: Implement lifecycle actions**

Invoke the two Compose files with `build`, `up -d --force-recreate
--remove-orphans`, `stop`, or `ps`. Make `Restart` run those operations in
Stop, Update, Start order. Build only buildable selected services and preserve
Docker volumes.

- [x] **Step 4: Implement renderer routing and readiness verification**

When `renderer` is selected, export `RENDER_SERVICE_URL` and
`VITE_RENDERER_PROXY_TARGET` as `http://renderer:3100`, create the selected data
directories, and retry a backend-container Python health request to
`http://renderer:3100/health` for up to 90 seconds.

- [x] **Step 5: Run the focused test to verify it passes**

Run: `bash tests/test-manage-local.sh`

Expected: PASS with `manage-local.sh parser tests passed`.

### Task 4: Document the Bash entry point

**Files:**
- Modify: `docs/native-windows-amd-renderer.md`

- [x] **Step 1: Add portable Bash usage**

Document the Bash commands, supported component behavior, portable CPU
renderer limitation, `OPENSHORTS_DATA_ROOT`/`--data-root`, and the distinction
from the Windows-only native AMD workflow.

### Task 5: Verify, review scope, and commit

**Files:**
- Verify: `scripts/manage-local.sh`
- Verify: `tests/test-manage-local.sh`
- Verify: `docker-compose.portable.yml`
- Verify: `docs/native-windows-amd-renderer.md`

- [x] **Step 1: Run shell and Compose checks**

Run:

```bash
bash -n scripts/manage-local.sh
bash -n tests/test-manage-local.sh
bash tests/test-manage-local.sh
docker compose --project-directory . --file docker-compose.yml --file docker-compose.portable.yml config
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 2: Review GitNexus scope**

Run GitNexus `detect_changes({scope: "staged"})` after staging only the files
for this feature. Confirm no unexpected symbols or execution flows are
affected.

- [x] **Step 3: Commit the implementation**

```bash
git add scripts/manage-local.sh tests/test-manage-local.sh docker-compose.portable.yml docs/native-windows-amd-renderer.md
git commit -m "feat: add portable bash local manager"
```
