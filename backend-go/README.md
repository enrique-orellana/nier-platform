# OpenShorts Go control plane

This service is the first migration slice of the OpenShorts backend. It owns
the control-plane contracts while the existing FastAPI service remains the
active production API.

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
- `MAX_CONCURRENT_JOBS`: future worker concurrency limit, default `5`.
- `RENDER_SERVICE_URL`: renderer address, default `http://localhost:3100`.

The Go service is currently a canary. Keep the existing FastAPI backend as
the frontend's active `/api` target until the remaining route contracts and
durable PostgreSQL repository are migrated.
