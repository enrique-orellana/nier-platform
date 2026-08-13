"""Versioned render manifests with immutable source verification."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from media_probe import MediaProbe


MANIFEST_SCHEMA_VERSION = 1
_TRANSIENT_KEYS = {"master", "updated_at", "render_status", "manifest_revision"}


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def register_asset(path: Path, project_dir: Path, probe: MediaProbe) -> dict:
    resolved_project = project_dir.resolve()
    resolved_path = path.resolve()
    if resolved_project not in resolved_path.parents:
        raise ValueError("asset path must be inside the project directory")
    if not resolved_path.is_file():
        raise ValueError(f"asset does not exist: {resolved_path}")
    return {
        "asset_id": sha256_file(resolved_path)[:16],
        "relative_path": resolved_path.relative_to(resolved_project).as_posix(),
        "sha256": sha256_file(resolved_path),
        "size_bytes": resolved_path.stat().st_size,
        "probe": {
            "width": probe.display_width,
            "height": probe.display_height,
            "fps": probe.fps,
            "fps_fraction": probe.fps_fraction,
            "duration_seconds": probe.duration_seconds,
            "codec": probe.codec,
            "pixel_format": probe.pixel_format,
            "color_transfer": probe.color_transfer,
        },
    }


def register_remote_asset(path: Path, probe: MediaProbe, source_object: dict) -> dict:
    """Register a temporary source without requiring a project-directory copy."""
    resolved_path = path.resolve()
    if not resolved_path.is_file():
        raise ValueError(f"asset does not exist: {resolved_path}")
    return {
        "asset_id": sha256_file(resolved_path)[:16],
        "relative_path": "",
        "sha256": sha256_file(resolved_path),
        "size_bytes": resolved_path.stat().st_size,
        "source_object": dict(source_object),
        "probe": {
            "width": probe.display_width,
            "height": probe.display_height,
            "fps": probe.fps,
            "fps_fraction": probe.fps_fraction,
            "duration_seconds": probe.duration_seconds,
            "codec": probe.codec,
            "pixel_format": probe.pixel_format,
            "color_transfer": probe.color_transfer,
        },
    }


def _canonical_manifest(manifest: dict) -> bytes:
    value = {
        key: item for key, item in manifest.items() if key not in _TRANSIENT_KEYS
    }
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def calculate_revision(manifest: dict) -> str:
    return hashlib.sha256(_canonical_manifest(manifest)).hexdigest()


def master_is_current(manifest: dict) -> bool:
    master = manifest.get("master") or {}
    return bool(
        master.get("video_url")
        and master.get("validated") is True
        and master.get("revision") == calculate_revision(manifest)
    )


def _asset_path(manifest: dict, project_dir: Path, relative_path: str) -> Path:
    root = project_dir.resolve()
    candidate = (root / relative_path).resolve()
    if root not in candidate.parents:
        raise ValueError("asset path escapes the project directory")
    return candidate


def verify_manifest_assets(manifest: dict, project_dir: Path) -> None:
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ValueError("unsupported manifest schema version")
    for asset in (manifest.get("assets") or {}).values():
        relative_path = asset.get("relative_path")
        expected_hash = asset.get("sha256")
        if not relative_path or not expected_hash:
            if asset.get("source_object") and expected_hash:
                continue
            raise ValueError("manifest asset is missing path or checksum")
        path = _asset_path(manifest, project_dir, relative_path)
        if not path.is_file():
            raise ValueError(f"manifest asset is missing: {relative_path}")
        if sha256_file(path) != expected_hash:
            raise ValueError(f"manifest asset checksum mismatch: {relative_path}")


def load_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ValueError("unsupported manifest schema version")
    declared_revision = manifest.get("manifest_revision")
    if declared_revision and declared_revision != calculate_revision(manifest):
        raise ValueError("manifest revision mismatch")
    return manifest


def save_manifest_atomic(path: Path, manifest: dict) -> str:
    manifest = dict(manifest)
    manifest["schema_version"] = MANIFEST_SCHEMA_VERSION
    declared_revision = manifest.get("manifest_revision")
    if declared_revision and declared_revision != calculate_revision(manifest):
        raise ValueError("manifest revision mismatch")
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    manifest.setdefault("master", None)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    return calculate_revision(manifest)
