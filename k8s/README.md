# Kubernetes Notes

This folder contains the manifests and helper notes for running OpenShorts
against the recovered MinIO deployment.

## Ingress controller

Install `ingress-nginx` with the bundled values:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  -f k8s/ingress-nginx-values.yaml
```

The ingress controller is exposed as a `LoadBalancer`, so the `nip.io`
hostnames should be reachable directly once the controller gets its external
address from the cluster.

## MinIO ingress

Upgrade the existing MinIO release with:

```bash
helm repo add minio https://charts.min.io
helm upgrade minio minio/minio \
  -n minio-system \
  -f k8s/minio-ingress-values.yaml
```

## OpenShorts app bundle

Build the local images from the repo root:

```bash
docker build -t openshorts-backend:local .
docker build -t openshorts-frontend:local -f dashboard/Dockerfile dashboard
docker build -t openshorts-renderer:local -f render-service/Dockerfile .
```

Create the namespace, then load the non-secret runtime settings from the env
example into a ConfigMap.

```bash
cp k8s/openshorts.env.example k8s/openshorts.env
kubectl create namespace openshorts --dry-run=client -o yaml | kubectl apply -f -

kubectl create configmap openshorts-config \
  -n openshorts \
  --from-env-file=k8s/openshorts.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Create the MinIO credentials secret. The secret only needs the
MinIO access key and secret.

```bash
kubectl create secret generic openshorts-minio \
  -n openshorts \
  --from-literal=AWS_ACCESS_KEY_ID=YOUR_MINIO_ACCESS_KEY \
  --from-literal=AWS_SECRET_ACCESS_KEY=YOUR_MINIO_SECRET_KEY \
  --dry-run=client -o yaml | kubectl apply -f -
```

If you want to mirror the currently deployed MinIO credentials, read them from
the `minio` secret in `minio-system` and reuse those values.

Apply the OpenShorts bundle:

```bash
kubectl apply -f k8s/openshorts.yaml
```

OpenShorts is exposed on one host and uses path routing:

- UI: `http://openshorts.127.0.0.1.nip.io`
- API: `http://openshorts.127.0.0.1.nip.io/api`

The backend talks to MinIO inside the cluster, and gallery/video URLs are
served back through the same ingress host. The recovered buckets remain:

- `AWS_S3_BUCKET=openshorts-media`
- `AWS_S3_PUBLIC_BUCKET=openshorts-media`

## One-command local update

This is the default Docker Desktop / local cluster flow. It keeps the `:local`
image tags and uses the checked-in manifest directly. The helper script loads
the root `.env` automatically, so you do not need to export anything. If you
want a different environment flavor, create a matching overlay file such as
`.env.local`, `.env.devel`, or `.env.quality` and pass the profile name.

```powershell
.\scripts\deploy-local.ps1
.\scripts\deploy-local.ps1 -Profile devel
```

```bash
bash ./scripts/deploy-local.sh
bash ./scripts/deploy-local.sh --profile quality
```

That single command:

- builds the backend, frontend, and renderer images with local tags
- applies `k8s/openshorts.yaml`
- refreshes the `openshorts-config` ConfigMap from `k8s/openshorts.env.example`
- restarts the three deployments
- waits for all rollouts to finish

If you want to change the local host URLs or model defaults, edit `.env` once
and rerun the same command. Profile overlays let you keep alternate settings in
`.env.local`, `.env.devel`, or `.env.quality` without exporting variables.

## One-command remote update

If you are deploying to a remote cluster with a registry, use the remote
helper from the repo root.

It reads the root `.env` by default and also accepts these environment
variables:

- `OPENSHORTS_REGISTRY`
- `OPENSHORTS_TAG`
- `OPENSHORTS_NAMESPACE`
- `OPENSHORTS_KUBE_CONTEXT`
- `OPENSHORTS_CONFIG_ENV_FILE`
- `OPENSHORTS_BACKEND_BASE_URL`
- `OPENSHORTS_FRONTEND_BASE_URL`
- `OPENSHORTS_S3_PUBLIC_URL_BASE`
- `OPENSHORTS_S3_PUBLIC_ENDPOINT_URL`

```powershell
$env:OPENSHORTS_REGISTRY = "ghcr.io/your-org"
$env:OPENSHORTS_TAG = "2026-05-03"
$env:OPENSHORTS_BACKEND_BASE_URL = "http://ollama.your-cluster.svc.cluster.local:11434"
$env:OPENSHORTS_FRONTEND_BASE_URL = "http://ollama.your-cluster.svc.cluster.local:11434"
$env:OPENSHORTS_S3_PUBLIC_URL_BASE = "https://minio.your-domain.example"
$env:OPENSHORTS_S3_PUBLIC_ENDPOINT_URL = "https://minio.your-domain.example"
.\scripts\deploy-remote.ps1
.\scripts\deploy-remote.ps1 -Profile quality
```

```bash
export OPENSHORTS_REGISTRY="ghcr.io/your-org"
export OPENSHORTS_TAG="2026-05-03"
export OPENSHORTS_BACKEND_BASE_URL="http://ollama.your-cluster.svc.cluster.local:11434"
export OPENSHORTS_FRONTEND_BASE_URL="http://ollama.your-cluster.svc.cluster.local:11434"
export OPENSHORTS_S3_PUBLIC_URL_BASE="https://minio.your-domain.example"
export OPENSHORTS_S3_PUBLIC_ENDPOINT_URL="https://minio.your-domain.example"
bash ./scripts/deploy-remote.sh
bash ./scripts/deploy-remote.sh --profile devel
```

The remote helper:

- builds and pushes registry images
- updates `openshorts-config`
- patches the three Kubernetes deployments
- waits for all rollouts to finish

## OpenShorts S3 settings

Use the variables in `openshorts.env.example` if you want a quick reference for
the non-secret runtime values, and `openshorts-minio.env.example` for the S3
subset:

- `MAX_CONCURRENT_JOBS` controls backend queue concurrency
- `AWS_S3_ENDPOINT_URL` points to the in-cluster MinIO service
- `AWS_S3_PUBLIC_URL_BASE` points to the MinIO ingress hostname
- `AWS_S3_PUBLIC_ENDPOINT_URL` should usually match the public ingress host
- `AWS_S3_BUCKET` should stay `openshorts-media`
- `AWS_S3_PUBLIC_BUCKET` should stay `openshorts-media`
- `RENDER_SERVICE_URL` points the backend at the renderer service
