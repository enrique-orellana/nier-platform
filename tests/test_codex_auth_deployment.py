from pathlib import Path


MANIFEST = Path(__file__).parents[1] / "k8s" / "openshorts.yaml"
CODEX_AUTH_FILE = "/app/output/.openshorts/codex-auth.json"


def _deployment_block(manifest: str, name: str) -> str:
    marker = f"  name: {name}\n"
    start = manifest.index(marker)
    end = manifest.find("\n---", start)
    return manifest[start:] if end == -1 else manifest[start:end]


def test_kubernetes_codex_auth_is_configured_for_shared_persistent_storage():
    manifest = MANIFEST.read_text(encoding="utf-8")
    backend = _deployment_block(manifest, "openshorts-backend")
    translation = _deployment_block(manifest, "openshorts-translation")

    assert f"  OPENSHORTS_CODEX_AUTH_FILE: {CODEX_AUTH_FILE}" in manifest
    assert f"mountPath: {CODEX_AUTH_FILE.rsplit('/', 2)[0]}" in backend
    assert f"mountPath: {CODEX_AUTH_FILE.rsplit('/', 2)[0]}" in translation

