from pathlib import Path


ROOT = Path(__file__).parents[1]
POSTGRES_MANIFEST = ROOT / "k8s" / "openshorts-postgres.yaml"
APP_MANIFEST = ROOT / "k8s" / "openshorts.yaml"


def test_postgres_bundle_has_persistent_storage_and_internal_service():
    manifest = POSTGRES_MANIFEST.read_text(encoding="utf-8")
    assert "kind: PersistentVolumeClaim" in manifest
    assert "name: openshorts-postgres-data" in manifest
    assert "kind: StatefulSet" in manifest
    assert "name: openshorts-postgres" in manifest
    assert "serviceName: openshorts-postgres" in manifest
    assert "replicas: 1" in manifest
    assert "kind: Service" in manifest
    assert "type: ClusterIP" in manifest
    assert "clusterIP: None" in manifest
    assert "port: 5432" in manifest


def test_postgres_uses_secret_and_persistent_volume():
    manifest = POSTGRES_MANIFEST.read_text(encoding="utf-8")
    assert "name: POSTGRES_DB" in manifest
    assert "name: POSTGRES_USER" in manifest
    assert "name: POSTGRES_PASSWORD" in manifest
    assert "secretKeyRef:" in manifest
    assert "claimName: openshorts-postgres-data" in manifest
    assert "pg_isready" in manifest


def test_backend_uses_database_url_secret():
    manifest = APP_MANIFEST.read_text(encoding="utf-8")
    assert "name: DATABASE_URL" in manifest
    assert "name: openshorts-postgres" in manifest
    assert "key: DATABASE_URL" in manifest
