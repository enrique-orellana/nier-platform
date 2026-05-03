#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-remote.sh --registry <registry> --tag <tag> [options]

Options:
  --profile <name>         Load .env.<name> after .env (examples: local, devel, quality)
  --namespace <ns>
  --context <kube-context>
  --config-env-file <path>
  --backend-base-url <url>
  --frontend-base-url <url>
  --s3-public-url-base <url>
  --s3-public-endpoint-url <url>
EOF
}

PROFILE="${OPENSHORTS_ENV_PROFILE:-}"
REGISTRY="${OPENSHORTS_REGISTRY:-}"
TAG="${OPENSHORTS_TAG:-}"
NAMESPACE="${OPENSHORTS_NAMESPACE:-}"
KUBE_CONTEXT="${OPENSHORTS_KUBE_CONTEXT:-}"
CONFIG_ENV_FILE="${OPENSHORTS_CONFIG_ENV_FILE:-}"
BACKEND_BASE_URL="${OPENSHORTS_BACKEND_BASE_URL:-}"
FRONTEND_BASE_URL="${OPENSHORTS_FRONTEND_BASE_URL:-}"
S3_PUBLIC_URL_BASE="${OPENSHORTS_S3_PUBLIC_URL_BASE:-}"
S3_PUBLIC_ENDPOINT_URL="${OPENSHORTS_S3_PUBLIC_ENDPOINT_URL:-}"

HAS_EXPLICIT_REGISTRY=0
HAS_EXPLICIT_TAG=0
HAS_EXPLICIT_NAMESPACE=0
HAS_EXPLICIT_KUBE_CONTEXT=0
HAS_EXPLICIT_CONFIG_ENV_FILE=0
HAS_EXPLICIT_BACKEND_BASE_URL=0
HAS_EXPLICIT_FRONTEND_BASE_URL=0
HAS_EXPLICIT_S3_PUBLIC_URL_BASE=0
HAS_EXPLICIT_S3_PUBLIC_ENDPOINT_URL=0

if [[ -n "${OPENSHORTS_REGISTRY+x}" ]]; then HAS_EXPLICIT_REGISTRY=1; fi
if [[ -n "${OPENSHORTS_TAG+x}" ]]; then HAS_EXPLICIT_TAG=1; fi
if [[ -n "${OPENSHORTS_NAMESPACE+x}" ]]; then HAS_EXPLICIT_NAMESPACE=1; fi
if [[ -n "${OPENSHORTS_KUBE_CONTEXT+x}" ]]; then HAS_EXPLICIT_KUBE_CONTEXT=1; fi
if [[ -n "${OPENSHORTS_CONFIG_ENV_FILE+x}" ]]; then HAS_EXPLICIT_CONFIG_ENV_FILE=1; fi
if [[ -n "${OPENSHORTS_BACKEND_BASE_URL+x}" ]]; then HAS_EXPLICIT_BACKEND_BASE_URL=1; fi
if [[ -n "${OPENSHORTS_FRONTEND_BASE_URL+x}" ]]; then HAS_EXPLICIT_FRONTEND_BASE_URL=1; fi
if [[ -n "${OPENSHORTS_S3_PUBLIC_URL_BASE+x}" ]]; then HAS_EXPLICIT_S3_PUBLIC_URL_BASE=1; fi
if [[ -n "${OPENSHORTS_S3_PUBLIC_ENDPOINT_URL+x}" ]]; then HAS_EXPLICIT_S3_PUBLIC_ENDPOINT_URL=1; fi

EXPLICIT_REGISTRY="${OPENSHORTS_REGISTRY:-}"
EXPLICIT_TAG="${OPENSHORTS_TAG:-}"
EXPLICIT_NAMESPACE="${OPENSHORTS_NAMESPACE:-}"
EXPLICIT_KUBE_CONTEXT="${OPENSHORTS_KUBE_CONTEXT:-}"
EXPLICIT_CONFIG_ENV_FILE="${OPENSHORTS_CONFIG_ENV_FILE:-}"
EXPLICIT_BACKEND_BASE_URL="${OPENSHORTS_BACKEND_BASE_URL:-}"
EXPLICIT_FRONTEND_BASE_URL="${OPENSHORTS_FRONTEND_BASE_URL:-}"
EXPLICIT_S3_PUBLIC_URL_BASE="${OPENSHORTS_S3_PUBLIC_URL_BASE:-}"
EXPLICIT_S3_PUBLIC_ENDPOINT_URL="${OPENSHORTS_S3_PUBLIC_ENDPOINT_URL:-}"

load_env_file() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --registry)
      REGISTRY="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --namespace)
      NAMESPACE="${2:-}"
      shift 2
      ;;
    --context)
      KUBE_CONTEXT="${2:-}"
      shift 2
      ;;
    --config-env-file)
      CONFIG_ENV_FILE="${2:-}"
      shift 2
      ;;
    --backend-base-url)
      BACKEND_BASE_URL="${2:-}"
      shift 2
      ;;
    --frontend-base-url)
      FRONTEND_BASE_URL="${2:-}"
      shift 2
      ;;
    --s3-public-url-base)
      S3_PUBLIC_URL_BASE="${2:-}"
      shift 2
      ;;
    --s3-public-endpoint-url)
      S3_PUBLIC_ENDPOINT_URL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -f ".env" ]]; then
  load_env_file ".env"
elif [[ -f ".env.example" ]]; then
  load_env_file ".env.example"
else
  printf 'No .env or .env.example found. Continuing with process environment only.\n' >&2
fi

if [[ -n "$PROFILE" ]]; then
  PROFILE_ENV_FILE=".env.${PROFILE}"
  if [[ -f "$PROFILE_ENV_FILE" ]]; then
    load_env_file "$PROFILE_ENV_FILE"
  else
    printf 'Profile env file not found: %s\n' "$PROFILE_ENV_FILE" >&2
  fi
fi

if [[ "$HAS_EXPLICIT_REGISTRY" -eq 1 ]]; then export OPENSHORTS_REGISTRY="$EXPLICIT_REGISTRY"; fi
if [[ "$HAS_EXPLICIT_TAG" -eq 1 ]]; then export OPENSHORTS_TAG="$EXPLICIT_TAG"; fi
if [[ "$HAS_EXPLICIT_NAMESPACE" -eq 1 ]]; then export OPENSHORTS_NAMESPACE="$EXPLICIT_NAMESPACE"; fi
if [[ "$HAS_EXPLICIT_KUBE_CONTEXT" -eq 1 ]]; then export OPENSHORTS_KUBE_CONTEXT="$EXPLICIT_KUBE_CONTEXT"; fi
if [[ "$HAS_EXPLICIT_CONFIG_ENV_FILE" -eq 1 ]]; then export OPENSHORTS_CONFIG_ENV_FILE="$EXPLICIT_CONFIG_ENV_FILE"; fi
if [[ -n "$PROFILE" ]]; then export OPENSHORTS_ENV_PROFILE="$PROFILE"; fi
if [[ "$HAS_EXPLICIT_BACKEND_BASE_URL" -eq 1 ]]; then export OPENSHORTS_BACKEND_BASE_URL="$EXPLICIT_BACKEND_BASE_URL"; fi
if [[ "$HAS_EXPLICIT_FRONTEND_BASE_URL" -eq 1 ]]; then export OPENSHORTS_FRONTEND_BASE_URL="$EXPLICIT_FRONTEND_BASE_URL"; fi
if [[ "$HAS_EXPLICIT_S3_PUBLIC_URL_BASE" -eq 1 ]]; then export OPENSHORTS_S3_PUBLIC_URL_BASE="$EXPLICIT_S3_PUBLIC_URL_BASE"; fi
if [[ "$HAS_EXPLICIT_S3_PUBLIC_ENDPOINT_URL" -eq 1 ]]; then export OPENSHORTS_S3_PUBLIC_ENDPOINT_URL="$EXPLICIT_S3_PUBLIC_ENDPOINT_URL"; fi

REGISTRY="${REGISTRY:-${OPENSHORTS_REGISTRY:-}}"
TAG="${TAG:-${OPENSHORTS_TAG:-}}"
NAMESPACE="${NAMESPACE:-${OPENSHORTS_NAMESPACE:-openshorts}}"
KUBE_CONTEXT="${KUBE_CONTEXT:-${OPENSHORTS_KUBE_CONTEXT:-}}"
CONFIG_ENV_FILE="${CONFIG_ENV_FILE:-${OPENSHORTS_CONFIG_ENV_FILE:-k8s/openshorts.env}}"
BACKEND_BASE_URL="${BACKEND_BASE_URL:-${OPENSHORTS_BACKEND_BASE_URL:-}}"
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-${OPENSHORTS_FRONTEND_BASE_URL:-}}"
S3_PUBLIC_URL_BASE="${S3_PUBLIC_URL_BASE:-${OPENSHORTS_S3_PUBLIC_URL_BASE:-}}"
S3_PUBLIC_ENDPOINT_URL="${S3_PUBLIC_ENDPOINT_URL:-${OPENSHORTS_S3_PUBLIC_ENDPOINT_URL:-}}"

log_step() {
  printf '\n==> %s\n' "$1"
}

if [[ -z "$REGISTRY" || -z "$TAG" ]]; then
  usage >&2
  exit 1
fi

for cmd in docker kubectl python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf "Required command '%s' was not found in PATH.\n" "$cmd" >&2
    exit 1
  fi
done

backend_image="${REGISTRY}/openshorts-backend:${TAG}"
frontend_image="${REGISTRY}/openshorts-frontend:${TAG}"
renderer_image="${REGISTRY}/openshorts-renderer:${TAG}"

kubectl_cmd=(kubectl)
if [[ -n "$KUBE_CONTEXT" ]]; then
  kubectl_cmd+=(--context "$KUBE_CONTEXT")
fi

apply_kubectl() {
  "${kubectl_cmd[@]}" "$@"
}

log_step "Building images"
docker build -t "$backend_image" .
docker build -t "$frontend_image" -f dashboard/Dockerfile dashboard
docker build -t "$renderer_image" -f render-service/Dockerfile .

log_step "Pushing images"
docker push "$backend_image"
docker push "$frontend_image"
docker push "$renderer_image"

if [[ ! -f "$CONFIG_ENV_FILE" ]]; then
  printf "Config env file not found: %s\n" "$CONFIG_ENV_FILE" >&2
  exit 1
fi

log_step "Applying config"
temp_env_file="$(mktemp)"
cp "$CONFIG_ENV_FILE" "$temp_env_file"

python3 - "$temp_env_file" "$BACKEND_BASE_URL" "$FRONTEND_BASE_URL" "$S3_PUBLIC_URL_BASE" "$S3_PUBLIC_ENDPOINT_URL" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
backend = sys.argv[2]
frontend = sys.argv[3]
s3_public = sys.argv[4]
s3_endpoint = sys.argv[5]

text = path.read_text()

def replace_line(name: str, value: str, content: str) -> str:
    if not value:
        return content
    pattern = rf"^{re.escape(name)}=.*$"
    replacement = f"{name}={value}"
    if re.search(pattern, content, flags=re.MULTILINE):
        return re.sub(pattern, replacement, content, flags=re.MULTILINE)
    return content + ("" if content.endswith("\n") else "\n") + replacement + "\n"

text = replace_line("AI_BASE_URL", backend, text)
text = replace_line("VITE_AI_BASE_URL", frontend, text)
text = replace_line("AWS_S3_PUBLIC_URL_BASE", s3_public, text)
text = replace_line("AWS_S3_PUBLIC_ENDPOINT_URL", s3_endpoint, text)

path.write_text(text)
PY

apply_kubectl create configmap openshorts-config \
  -n "$NAMESPACE" \
  --from-env-file="$temp_env_file" \
  --dry-run=client -o yaml | apply_kubectl apply -f -
rm -f "$temp_env_file"

log_step "Updating deployment images"
apply_kubectl set image deployment/openshorts-backend backend="$backend_image" -n "$NAMESPACE"
apply_kubectl set image deployment/openshorts-frontend frontend="$frontend_image" -n "$NAMESPACE"
apply_kubectl set image deployment/openshorts-renderer renderer="$renderer_image" -n "$NAMESPACE"

log_step "Waiting for rollouts"
apply_kubectl rollout status deployment/openshorts-backend -n "$NAMESPACE" --timeout=180s
apply_kubectl rollout status deployment/openshorts-frontend -n "$NAMESPACE" --timeout=180s
apply_kubectl rollout status deployment/openshorts-renderer -n "$NAMESPACE" --timeout=180s

printf '\nRemote deploy completed successfully.\n'
