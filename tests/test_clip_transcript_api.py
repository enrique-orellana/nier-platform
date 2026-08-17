import json
import shutil
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

import app as app_module


def test_clip_transcript_api_keeps_segment_only_provider_subtitles(monkeypatch):
    output_root = Path.cwd() / f".subtitle-api-test-{uuid.uuid4().hex}"
    output_root.mkdir()
    try:
        monkeypatch.setattr(app_module, "OUTPUT_DIR", str(output_root))
        job_id = "provider-job"
        output_dir = output_root / job_id
        output_dir.mkdir()
        metadata = {
            "transcript": {
                "language": "es",
                "segments": [{
                    "start": 10.0,
                    "end": 12.5,
                    "text": "Hola, esto sigue funcionando.",
                    "words": [],
                }],
            },
            "shorts": [{"start": 10.0, "end": 12.5}],
        }
        (output_dir / "source_metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        app_module.jobs.clear()
        app_module.jobs[job_id] = {"result": {"clips": [dict(metadata["shorts"][0])]}}

        response = TestClient(app_module.app).get(f"/api/clip/{job_id}/0/transcript")
    finally:
        app_module.jobs.clear()
        shutil.rmtree(output_root, ignore_errors=True)

    assert response.status_code == 200
    assert response.json() == {
        "captions": [{
            "text": "Hola, esto sigue",
            "startMs": 0,
            "endMs": 1875,
        }, {
            "text": "funcionando.",
            "startMs": 1875,
            "endMs": 2500,
        }],
        "durationSec": 2.5,
        "language": "es",
    }
