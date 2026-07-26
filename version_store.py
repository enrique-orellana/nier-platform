"""Atomic, immutable clip-version storage for manifest-backed edits."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from render_manifest import calculate_revision


@dataclass(frozen=True)
class VersionRecord:
    version_id: str
    parent_version_id: str | None
    manifest_revision: str
    status: str
    output_url: str | None = None
    error: str | None = None
    created_at: str | None = None


class VersionStore:
    """Persist immutable manifests and a small atomic current-version index."""

    def __init__(self, clip_root: Path):
        self.clip_root = Path(clip_root).resolve()
        self.versions_dir = self.clip_root / "versions"
        self.index_path = self.versions_dir / "index.json"
        self.versions_dir.mkdir(parents=True, exist_ok=True)

    @property
    def current_version_id(self) -> str | None:
        return self._read_index()["current_version_id"]

    @staticmethod
    def _validate_id(version_id: str) -> str:
        try:
            return str(uuid.UUID(str(version_id)))
        except (ValueError, AttributeError, TypeError) as exc:
            raise ValueError("invalid version id") from exc

    def create_version(self, manifest: dict[str, Any], parent_version_id: str | None) -> VersionRecord:
        index = self._read_index()
        if parent_version_id is not None:
            parent_version_id = self._validate_id(parent_version_id)
        if parent_version_id is not None and parent_version_id not in index["versions"]:
            raise ValueError("parent version does not exist")

        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        version_manifest = dict(manifest)
        version_manifest["version_id"] = version_id
        version_manifest["parent_version_id"] = parent_version_id
        version_manifest["render_status"] = "pending"
        version_manifest["master"] = None
        revision = calculate_revision(version_manifest)
        version_manifest["manifest_revision"] = revision

        manifest_path = self.versions_dir / f"{version_id}.json"
        self._atomic_write(manifest_path, version_manifest)
        record = VersionRecord(
            version_id=version_id,
            parent_version_id=parent_version_id,
            manifest_revision=revision,
            status="pending",
            created_at=now,
        )
        index["versions"][version_id] = self._record_dict(record)
        self._write_index(index)
        return record

    def load_version(self, version_id: str) -> VersionRecord:
        version_id = self._validate_id(version_id)
        record = self._read_index()["versions"].get(version_id)
        if record is None:
            raise ValueError("version does not exist")
        return self._record_from_dict(record)

    def load_manifest(self, version_id: str) -> dict[str, Any]:
        version_id = self._validate_id(version_id)
        self.load_version(version_id)
        path = self.versions_dir / f"{version_id}.json"
        if not path.is_file():
            raise ValueError("version manifest is missing")
        return json.loads(path.read_text(encoding="utf-8"))

    def list_versions(self) -> list[VersionRecord]:
        records = [self._record_from_dict(item) for item in self._read_index()["versions"].values()]
        return sorted(records, key=lambda item: item.created_at or "")

    def update_render(self, version_id: str, status: str, error: str | None = None) -> VersionRecord:
        if status not in {"pending", "rendering", "done", "failed"}:
            raise ValueError("invalid render status")
        version_id = self._validate_id(version_id)
        index = self._read_index()
        record = index["versions"].get(version_id)
        if record is None:
            raise ValueError("version does not exist")
        record["status"] = status
        record["error"] = error
        self._write_index(index)
        return self._record_from_dict(record)

    def promote_version(self, version_id: str, output_url: str) -> VersionRecord:
        if not output_url:
            raise ValueError("successful version requires an output URL")
        version_id = self._validate_id(version_id)
        index = self._read_index()
        record = index["versions"].get(version_id)
        if record is None:
            raise ValueError("version does not exist")
        if record["status"] != "done":
            raise ValueError("only successful versions can become current")
        record["output_url"] = output_url
        index["current_version_id"] = version_id
        self._write_index(index)
        return self._record_from_dict(record)

    def _read_index(self) -> dict[str, Any]:
        if not self.index_path.is_file():
            return {"current_version_id": None, "versions": {}}
        return json.loads(self.index_path.read_text(encoding="utf-8"))

    def _write_index(self, index: dict[str, Any]) -> None:
        self._atomic_write(self.index_path, index)

    @staticmethod
    def _atomic_write(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)

    @staticmethod
    def _record_dict(record: VersionRecord) -> dict[str, Any]:
        return {
            "version_id": record.version_id,
            "parent_version_id": record.parent_version_id,
            "manifest_revision": record.manifest_revision,
            "status": record.status,
            "output_url": record.output_url,
            "error": record.error,
            "created_at": record.created_at,
        }

    @staticmethod
    def _record_from_dict(value: dict[str, Any]) -> VersionRecord:
        return VersionRecord(
            version_id=value["version_id"],
            parent_version_id=value.get("parent_version_id"),
            manifest_revision=value["manifest_revision"],
            status=value["status"],
            output_url=value.get("output_url"),
            error=value.get("error"),
            created_at=value.get("created_at"),
        )
