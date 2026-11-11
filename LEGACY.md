# Legacy Python surface

The Go control plane is the production HTTP entrypoint. The remaining Python
surface is transitional legacy code and must not be treated as a second API
implementation.

## Retained legacy entrypoints

- `main.py` — legacy media/AI generation worker launched by the Go control plane.
- `python_worker.py` — legacy JSON-lines worker bridge launched by the Go control plane.

The translation worker implementation now lives in
`openshorts/subtitles/translation_worker.py` and is called through the worker
bridge. Supporting modules are grouped under `openshorts/`; `requirements.txt`
and the Python tests for these entrypoints and modules remain part of the same
transitional legacy surface.

## Removal gate

Do not delete this code until the Go implementation replaces the worker
capabilities and the production image no longer needs Python, the Python
worker contract, or the associated model/media dependencies.
