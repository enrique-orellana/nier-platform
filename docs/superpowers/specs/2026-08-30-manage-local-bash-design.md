# Cross-Platform Bash Local Manager Design

**Goal:** Add a Bash entry point for managing the local OpenShorts stack on Linux, macOS, WSL, and Git Bash without depending on PowerShell or Windows-only paths.

## Scope

Create `scripts/manage-local.sh` with the same lifecycle actions as
`scripts/manage-local.ps1`: `Update`, `Start`, `Stop`, `Restart`, and `Status`.
It will accept comma-separated component selection and use Docker Compose for
all lifecycle operations.

The existing PowerShell script remains the Windows-native AMD/AMF workflow.
The Bash workflow will use the renderer container, which is portable but uses
the renderer's software/CPU path rather than Windows AMD AMF acceleration.

## Architecture

The Bash script will resolve the repository root from its own location, require
`bash` and `docker`, and invoke `docker compose` with an additional portable
Compose override. The override will define the currently commented renderer
service and route backend/frontend renderer traffic to `http://renderer:3100`.

The portable workflow will use `${OPENSHORTS_DATA_ROOT:-$repo_root/.local-data}`
for persistent Postgres and renderer output data. Users may override that
location with `OPENSHORTS_DATA_ROOT` or the script's `--data-root` option.

Component behavior:

- `all`: manage `db`, `backend`, `frontend`, and `renderer`.
- `db`, `backend`, `frontend`: manage the matching Docker service.
- `renderer`: manage the Docker renderer and its backend dependency.
- `native-renderer`: reject with a clear portability message; it remains a
  PowerShell-only feature.

When the renderer is selected, the script will include the backend because the
portable renderer reports metrics to it. When a standalone backend is selected,
its configured `RENDER_SERVICE_URL` remains available for users who provide an
external renderer endpoint.

## CLI

Supported forms:

```text
./scripts/manage-local.sh [--action ACTION] [--component COMPONENTS] [--data-root PATH]
./scripts/manage-local.sh ACTION [COMPONENTS]
```

`ACTION` defaults to `Status`; valid values are `Update`, `Start`, `Stop`,
`Restart`, and `Status`. `--help` will describe the interface and examples.

The script will reject unknown options, missing option values, invalid actions,
unknown components, and mixing `all` with individual components before calling
Docker.

## Lifecycle and error handling

- `Update` runs `docker compose build` for the selected services.
- `Start` runs `docker compose up -d --force-recreate --remove-orphans` for
  the selected services and waits for the portable renderer/backend path to
  respond when the renderer is selected.
- `Stop` runs `docker compose stop` and preserves volumes.
- `Restart` performs Stop, Update, then Start in that order.
- `Status` runs `docker compose ps` for the selected services.

Every external command will run with `set -euo pipefail`; required commands and
required Compose files will be checked up front. Paths will be quoted and no
temporary generated Compose file will be left behind.

## Verification

Add shell-level tests or deterministic checks for argument parsing, repository
root resolution, component expansion, and rejection of `native-renderer`.
Run `bash -n scripts/manage-local.sh`, the focused checks, and a no-op help and
validation smoke test that do not require Docker services.
