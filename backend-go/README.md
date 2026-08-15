# OpenShorts Go control plane

This service is the production HTTP control plane for OpenShorts. Python remains
an internal worker for media and AI workloads; it is not an HTTP server.

The retained Python entrypoints are transitional legacy code documented in
the repository-level [`LEGACY.md`](../LEGACY.md). They can be removed after
the worker capabilities and model/media dependencies are migrated to Go.

## Local run

```powershell
$env:GOCACHE = "$PWD/.cache"
go test -race ./...
go run ./cmd/api
```

The service listens on port `8000` by default. Check it with:

```powershell
Invoke-WebRequest http://localhost:8000/health
```

## Configuration

- `PORT`: HTTP port, default `8000`.
- `MAX_CONCURRENT_JOBS`: maximum concurrent Python jobs, default `5`.
- `RENDER_SERVICE_URL`: renderer address, default `http://localhost:3100`.
- `DATABASE_URL`: PostgreSQL connection URL. Required for durable production job state and Highlights project persistence.
- `PYTHON_BINARY`: Python executable for the internal worker, default `python`.
- `PYTHON_WORKER_SCRIPT`: worker entrypoint, default `python_worker.py`.

Without `DATABASE_URL`, local development falls back to in-memory job storage;
all jobs and Highlights projects are lost when the process exits. Production deployments must provide
the URL (the Kubernetes manifest expects the `openshorts-postgres` secret with
key `DATABASE_URL`) and use the `/ready` endpoint for readiness checks. OpenAPI endpoints
from the former FastAPI service are not served by the Go control plane yet.
