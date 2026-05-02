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

For this Docker Desktop cluster, I used a local port-forward so the nip.io
hostnames work without a port number:

```bash
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 80:80
```

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
