import json
from pathlib import Path

from fastapi.testclient import TestClient

import app as app_module
from hooks import hook_style_for_layout


def test_hook_style_defaults_to_legacy_and_maps_streamer_stack():
    assert hook_style_for_layout(None) == "legacy"
    assert hook_style_for_layout("standard") == "legacy"
    assert hook_style_for_layout("streamer_stack") == "streamer"


def test_hook_route_uses_streamer_style_for_streamer_stack_clip(tmp_path, monkeypatch):
    job_id = "job-streamer"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    (output_dir / "source_metadata.json").write_text(
        json.dumps({"shorts": [{"layout_format": "streamer_stack"}]}),
        encoding="utf-8",
    )
    input_path = output_dir / "clip.mp4"
    input_path.write_bytes(b"video")
    job = {"result": {"clips": [{}]}}
    calls = []

    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_get_job", lambda _job_id: job)
    monkeypatch.setattr(
        app_module,
        "_resolve_job_clip_input",
        lambda *_args: (str(input_path), "clip.mp4"),
    )

    def fake_add_hook(input_file, text, output_file, **kwargs):
        calls.append((input_file, text, output_file, kwargs))
        Path(output_file).write_bytes(b"hooked")

    monkeypatch.setattr(app_module, "add_hook_to_video", fake_add_hook)

    response = TestClient(app_module.app).post(
        "/api/hook",
        json={"job_id": job_id, "clip_index": 0, "text": "Watch this"},
    )

    assert response.status_code == 200
    assert calls[0][3]["style"] == "streamer"


def test_hook_route_defaults_to_legacy_style_without_layout_metadata(tmp_path, monkeypatch):
    job_id = "job-standard"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    (output_dir / "source_metadata.json").write_text(
        json.dumps({"shorts": [{}]}),
        encoding="utf-8",
    )
    input_path = output_dir / "clip.mp4"
    input_path.write_bytes(b"video")
    job = {"result": {"clips": [{}]}}
    calls = []

    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_get_job", lambda _job_id: job)
    monkeypatch.setattr(
        app_module,
        "_resolve_job_clip_input",
        lambda *_args: (str(input_path), "clip.mp4"),
    )

    def fake_add_hook(_input_file, _text, output_file, **kwargs):
        calls.append(kwargs)
        Path(output_file).write_bytes(b"hooked")

    monkeypatch.setattr(app_module, "add_hook_to_video", fake_add_hook)

    response = TestClient(app_module.app).post(
        "/api/hook",
        json={"job_id": job_id, "clip_index": 0, "text": "Watch this"},
    )

    assert response.status_code == 200
    assert calls[0]["style"] == "legacy"
