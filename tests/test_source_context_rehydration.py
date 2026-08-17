import json

import app as app_module


SOURCE_URL = "https://www.twitch.tv/videos/2842570758"
SOURCE_CONTEXT = {
    "who": ["Streamer"],
    "what": "Launch event",
    "where": "Rome",
    "when": "",
    "entities": ["launch event"],
    "source_summary": "Streamer discusses a launch event in Rome.",
    "confidence": "high",
}


def test_result_payload_exposes_source_context_and_attaches_it_to_ready_clips():
    data = {
        "source_url": SOURCE_URL,
        "source_metadata": {"platform": "twitch", "title": "A live event"},
        "source_asset": {"probe": {"duration_seconds": 3577.0}},
        "source_context": SOURCE_CONTEXT,
        "source_context_status": "available",
        "source_context_error": None,
    }

    result = app_module.build_job_result(data, [{"video_url": "/videos/job/clip.mp4"}], {"total_cost": 0})

    assert result["source_url"] == SOURCE_URL
    assert result["source_context"] == SOURCE_CONTEXT
    assert result["clips"][0]["source_context"] == SOURCE_CONTEXT
    assert result["source_duration_seconds"] == 3577.0
    assert result["cost_analysis"] == {"total_cost": 0}


def test_disk_rehydration_returns_persisted_source_context(monkeypatch, tmp_path):
    job_id = "source-context-job"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    metadata_path = output_dir / "source_metadata_metadata.json"
    metadata_path.write_text(json.dumps({
        "source_url": SOURCE_URL,
        "source_metadata": {"platform": "twitch", "title": "A live event"},
        "source_context": SOURCE_CONTEXT,
        "source_context_status": "available",
        "source_context_error": None,
        "cost_analysis": {"total_cost": 0},
        "shorts": [{"start": 0, "end": 20, "video_filename": "source_clip_1.mp4"}],
    }), encoding="utf-8")
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))

    result = app_module._rehydrate_job_from_disk(job_id)

    assert result["result"]["source_url"] == SOURCE_URL
    assert result["result"]["source_context"] == SOURCE_CONTEXT
    assert result["result"]["clips"][0]["source_context"] == SOURCE_CONTEXT
