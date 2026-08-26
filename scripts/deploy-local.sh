#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-local.sh [--profile <name>]

Options:
  --profile <name>   Load .env.<name> after .env (examples: local, devel, quality)
EOF
}

PROFILE="${OPENSHORTS_ENV_PROFILE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
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

EXPLICIT_NAMESPACE="${OPENSHORTS_NAMESPACE-}"
EXPLICIT_KUBE_CONTEXT="${OPENSHORTS_KUBE_CONTEXT-}"
EXPLICIT_CONFIG_ENV_FILE="${OPENSHORTS_CONFIG_ENV_FILE-}"
EXPLICIT_BACKEND_BASE_URL="${AI_BASE_URL:-${OPENSHORTS_AI_BASE_URL-}}"
EXPLICIT_FRONTEND_BASE_URL="${VITE_AI_BASE_URL:-${OPENSHORTS_VITE_AI_BASE_URL-}}"
EXPLICIT_S3_PUBLIC_URL_BASE="${AWS_S3_PUBLIC_URL_BASE:-${OPENSHORTS_S3_PUBLIC_URL_BASE-}}"
EXPLICIT_S3_PUBLIC_ENDPOINT_URL="${AWS_S3_PUBLIC_ENDPOINT_URL:-${OPENSHORTS_S3_PUBLIC_ENDPOINT_URL-}}"
EXPLICIT_GPU_RUNTIME="${OPENSHORTS_GPU_RUNTIME-}"

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

add_no_proxy_host() {
  local host="$1"
  local current="${NO_PROXY:-${no_proxy:-}}"
  if [[ ",$current," != *",$host,"* ]]; then
    if [[ -n "$current" ]]; then
      current="${current},${host}"
    else
      current="$host"
    fi
  fi
  export NO_PROXY="$current"
  export no_proxy="$current"
}

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

if [[ -n "$EXPLICIT_NAMESPACE" ]]; then export OPENSHORTS_NAMESPACE="$EXPLICIT_NAMESPACE"; fi
if [[ -n "$EXPLICIT_KUBE_CONTEXT" ]]; then export OPENSHORTS_KUBE_CONTEXT="$EXPLICIT_KUBE_CONTEXT"; fi
if [[ -n "$EXPLICIT_CONFIG_ENV_FILE" ]]; then export OPENSHORTS_CONFIG_ENV_FILE="$EXPLICIT_CONFIG_ENV_FILE"; fi
if [[ -n "$PROFILE" ]]; then export OPENSHORTS_ENV_PROFILE="$PROFILE"; fi
if [[ -n "$EXPLICIT_BACKEND_BASE_URL" ]]; then export OPENSHORTS_AI_BASE_URL="$EXPLICIT_BACKEND_BASE_URL"; fi
if [[ -n "$EXPLICIT_FRONTEND_BASE_URL" ]]; then export OPENSHORTS_VITE_AI_BASE_URL="$EXPLICIT_FRONTEND_BASE_URL"; fi
if [[ -n "$EXPLICIT_S3_PUBLIC_URL_BASE" ]]; then export OPENSHORTS_S3_PUBLIC_URL_BASE="$EXPLICIT_S3_PUBLIC_URL_BASE"; fi
if [[ -n "$EXPLICIT_S3_PUBLIC_ENDPOINT_URL" ]]; then export OPENSHORTS_S3_PUBLIC_ENDPOINT_URL="$EXPLICIT_S3_PUBLIC_ENDPOINT_URL"; fi
if [[ -n "$EXPLICIT_GPU_RUNTIME" ]]; then export OPENSHORTS_GPU_RUNTIME="$EXPLICIT_GPU_RUNTIME"; fi

KUBE_CONTEXT="${OPENSHORTS_KUBE_CONTEXT:-}"
NAMESPACE="${OPENSHORTS_NAMESPACE:-openshorts}"
CONFIG_ENV_FILE="${OPENSHORTS_CONFIG_ENV_FILE:-k8s/openshorts.env.example}"
AI_BASE_URL="${AI_BASE_URL:-${OPENSHORTS_AI_BASE_URL:-}}"
VITE_AI_BASE_URL="${VITE_AI_BASE_URL:-${OPENSHORTS_VITE_AI_BASE_URL:-}}"
S3_PUBLIC_URL_BASE="${AWS_S3_PUBLIC_URL_BASE:-${OPENSHORTS_S3_PUBLIC_URL_BASE:-}}"
S3_PUBLIC_ENDPOINT_URL="${AWS_S3_PUBLIC_ENDPOINT_URL:-${OPENSHORTS_S3_PUBLIC_ENDPOINT_URL:-}}"
GPU_RUNTIME="${OPENSHORTS_GPU_RUNTIME:-rocm-wsl}"
case "$GPU_RUNTIME" in
  cuda) backend_dockerfile="Dockerfile.cuda"; renderer_accelerator="auto" ;;
  rocm-linux) backend_dockerfile="Dockerfile.rocm-linux"; renderer_accelerator="auto" ;;
  rocm-wsl) backend_dockerfile="Dockerfile"; renderer_accelerator="auto" ;;
  cpu) backend_dockerfile="Dockerfile.cuda"; renderer_accelerator="cpu" ;;
  *) printf 'OPENSHORTS_GPU_RUNTIME must be cuda, rocm-linux, rocm-wsl, or cpu.\n' >&2; exit 1 ;;
esac
export GPU_RUNTIME RENDER_ACCELERATOR="$renderer_accelerator" RENDER_HARDWARE_ACCELERATION="if-possible"
POSTGRES_DB="${OPENSHORTS_POSTGRES_DB:-openshorts}"
POSTGRES_USER="${OPENSHORTS_POSTGRES_USER:-openshorts}"
POSTGRES_PASSWORD="${OPENSHORTS_POSTGRES_PASSWORD:-openshorts-local}"
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@openshorts-postgres:5432/${POSTGRES_DB}"

log_step() {
  printf '\n==> %s\n' "$1"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Required command 'docker' was not found in PATH." >&2
  exit 1
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "Required command 'kubectl' was not found in PATH." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Required command 'python3' was not found in PATH." >&2
  exit 1
fi

backend_image="openshorts-backend:local"
frontend_image="openshorts-frontend:local"
renderer_image="openshorts-renderer:local"

add_no_proxy_host "localhost"
add_no_proxy_host "127.0.0.1"
add_no_proxy_host "::1"
add_no_proxy_host "kubernetes.docker.internal"

kubectl_cmd=(kubectl)
if [[ -n "$KUBE_CONTEXT" ]]; then
  kubectl_cmd+=(--context "$KUBE_CONTEXT")
fi

apply_kubectl() {
  "${kubectl_cmd[@]}" "$@"
}

remove_gpu_requests() {
  apply_kubectl patch deployment/openshorts-backend -n "$NAMESPACE" --type=json -p='[{"op":"remove","path":"/spec/template/spec/containers/0/resources/requests/nvidia.com~1gpu"},{"op":"remove","path":"/spec/template/spec/containers/0/resources/limits/nvidia.com~1gpu"}]'
  apply_kubectl patch deployment/openshorts-renderer -n "$NAMESPACE" --type=json -p='[{"op":"remove","path":"/spec/template/spec/containers/0/resources/requests/nvidia.com~1gpu"},{"op":"remove","path":"/spec/template/spec/containers/0/resources/limits/nvidia.com~1gpu"}]'
}

log_step "Building local images"
if [[ "$GPU_RUNTIME" == "cpu" ]]; then
  docker build -t "$backend_image" -f "$backend_dockerfile" --build-arg OPENSHORTS_DEVICE=cpu .
else
  docker build -t "$backend_image" -f "$backend_dockerfile" .
fi
docker build -t "$frontend_image" -f dashboard/Dockerfile dashboard
docker build -t "$renderer_image" -f render-service/Dockerfile .

if [[ ! -f "k8s/openshorts.yaml" ]]; then
  echo "Missing k8s/openshorts.yaml" >&2
  exit 1
fi

if [[ ! -f "k8s/openshorts-postgres.yaml" ]]; then
  echo "Missing k8s/openshorts-postgres.yaml" >&2
  exit 1
fi

log_step "Preparing PostgreSQL Secret"
apply_kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | apply_kubectl apply -f -
apply_kubectl create secret generic openshorts-postgres \
  -n "$NAMESPACE" \
  --from-literal="POSTGRES_DB=$POSTGRES_DB" \
  --from-literal="POSTGRES_USER=$POSTGRES_USER" \
  --from-literal="POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
  --from-literal="DATABASE_URL=$DATABASE_URL" \
  --dry-run=client -o yaml | apply_kubectl apply -f -

log_step "Applying PostgreSQL"
apply_kubectl apply -f k8s/openshorts-postgres.yaml
apply_kubectl rollout status deployment/openshorts-postgres -n "$NAMESPACE" --timeout=180s

log_step "Applying bundle"
apply_kubectl apply -f k8s/openshorts.yaml

if [[ ! -f "$CONFIG_ENV_FILE" ]]; then
  echo "Config env file not found: $CONFIG_ENV_FILE" >&2
  exit 1
fi

log_step "Updating config map from env file"
temp_env_file="$(mktemp)"
cp "$CONFIG_ENV_FILE" "$temp_env_file"

python3 - "$temp_env_file" "$AI_BASE_URL" "$VITE_AI_BASE_URL" "$S3_PUBLIC_URL_BASE" "$S3_PUBLIC_ENDPOINT_URL" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
ai_base = sys.argv[2]
vite_base = sys.argv[3]
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

text = replace_line("AI_BASE_URL", ai_base, text)
text = replace_line("VITE_AI_BASE_URL", vite_base, text)
text = replace_line("AWS_S3_PUBLIC_URL_BASE", s3_public, text)
text = replace_line("AWS_S3_PUBLIC_ENDPOINT_URL", s3_endpoint, text)
text = replace_line("OPENSHORTS_GPU_RUNTIME", os.environ.get("GPU_RUNTIME", ""), text)
text = replace_line("OPENSHORTS_DEVICE", "cpu" if os.environ.get("GPU_RUNTIME") == "cpu" else "auto", text)
text = replace_line("RENDER_ACCELERATOR", os.environ.get("RENDER_ACCELERATOR", ""), text)
text = replace_line("RENDER_HARDWARE_ACCELERATION", os.environ.get("RENDER_HARDWARE_ACCELERATION", "if-possible"), text)

path.write_text(text)
PY

apply_kubectl create configmap openshorts-config \
  -n "$NAMESPACE" \
  --from-env-file="$temp_env_file" \
  --dry-run=client -o yaml | apply_kubectl apply -f -
rm -f "$temp_env_file"

if [[ "$GPU_RUNTIME" == "cpu" ]]; then
  remove_gpu_requests
fi

log_step "Updating deployment images"
apply_kubectl set image deployment/openshorts-backend backend="$backend_image" -n "$NAMESPACE"
apply_kubectl set image deployment/openshorts-frontend frontend="$frontend_image" -n "$NAMESPACE"
apply_kubectl set image deployment/openshorts-renderer renderer="$renderer_image" -n "$NAMESPACE"

log_step "Restarting deployments"
apply_kubectl rollout restart deployment/openshorts-backend deployment/openshorts-frontend deployment/openshorts-renderer -n "$NAMESPACE"

log_step "Waiting for rollouts"
apply_kubectl rollout status deployment/openshorts-backend -n "$NAMESPACE" --timeout=180s
apply_kubectl rollout status deployment/openshorts-frontend -n "$NAMESPACE" --timeout=180s
apply_kubectl rollout status deployment/openshorts-renderer -n "$NAMESPACE" --timeout=180s

printf '\nLocal deploy completed successfully.\n'
