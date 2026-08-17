import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

import app as app_module


def test_video_url_update_persists_subtitle_layers_and_tracks(monkeypatch):
    tmp_path = Path(__file__).parent / ".subtitle-persistence-tmp"
    shutil.rmtree(tmp_path, ignore_errors=True)
    tmp_path.mkdir()
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    job_id = "subtitle-job"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    metadata = {
        "shorts": [{
            "video_url": "/videos/subtitle-job/clip.mp4",
            "start": 0,
            "end": 3,
            "layers": {"hook": None, "subtitles": None, "effects": None},
            "subtitle_tracks": [],
        }],
    }
    metadata_path = output_dir / "subtitle-job_metadata.json"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    app_module.jobs.clear()
    app_module.jobs[job_id] = {"result": {"clips": [dict(metadata["shorts"][0])]}}

    subtitles = {
        "captions": [{"text": "Hello", "startMs": 0, "endMs": 900}],
        "position": "bottom",
        "style": {"animation": "pop"},
    }
    tracks = [{
        "id": "original",
        "label": "Original",
        "language": "en",
        "origin": "generated",
        "cues": subtitles["captions"],
        "captions": subtitles["captions"],
    }]

    try:
        response = TestClient(app_module.app).post(
            f"/api/clip/{job_id}/0/video-url",
            json={
                "new_video_url": "/videos/subtitle-job/subtitled-clip.mp4",
                "layers": {"subtitles": subtitles},
                "subtitle_tracks": tracks,
                "active_subtitle_track_id": "original",
            },
        )

        assert response.status_code == 200
        persisted = json.loads(metadata_path.read_text(encoding="utf-8"))["shorts"][0]
        assert persisted["video_url"].endswith("subtitled-clip.mp4")
        assert persisted["layers"]["subtitles"] == subtitles
        assert persisted["subtitle_tracks"] == tracks
        assert persisted["active_subtitle_track_id"] == "original"
        assert app_module.jobs[job_id]["result"]["clips"][0]["subtitle_tracks"] == tracks
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)
