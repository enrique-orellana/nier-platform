import json
from pathlib import Path
from unittest.mock import patch

import python_worker
from hooks import add_hook_to_video, hook_style_for_layout


def test_hook_style_defaults_to_legacy_and_maps_streamer_stack():
    assert hook_style_for_layout(None) == "legacy"
    assert hook_style_for_layout("standard") == "legacy"
    assert hook_style_for_layout("streamer_stack") == "streamer"


def test_worker_hook_uses_streamer_style_and_facecam_size(tmp_path, monkeypatch):
    job_id = "job-worker-streamer"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    (output_dir / "source_metadata.json").write_text(
        json.dumps({
            "shorts": [{
                "video_filename": "clip.mp4",
                "layout_format": "streamer_stack",
                "facecam_size": "small",
            }],
        }),
        encoding="utf-8",
    )
    (output_dir / "clip.mp4").write_bytes(b"video")
    calls = []

    def fake_add_hook(input_file, text, output_file, **kwargs):
        calls.append((input_file, text, output_file, kwargs))
        Path(output_file).write_bytes(b"hooked")

    monkeypatch.setattr("hooks.add_hook_to_video", fake_add_hook)

    result = python_worker._legacy_api({
        "output_dir": str(tmp_path),
        "payload": {
            "action": "hook",
            "job_id": job_id,
            "clip_index": 0,
            "text": "Watch this",
            "position": "top",
            "size": "M",
            "input_filename": "clip.mp4",
        },
    })

    assert result["success"] is True
    assert calls[0][3]["style"] == "streamer"
    assert calls[0][3]["facecam_size"] == "small"


def test_streamer_hook_centers_on_selected_facecam_boundary(tmp_path):
    input_path = tmp_path / "clip.mp4"
    input_path.write_bytes(b"video")
    ffmpeg_calls = []

    with patch("hooks.subprocess.check_output", return_value=b"1080x1920\n"), patch(
        "hooks.create_hook_image", return_value=("hook.png", 300, 100)
    ), patch("hooks.subprocess.run", side_effect=lambda command, **_kwargs: ffmpeg_calls.append(command)):
        add_hook_to_video(
            str(input_path),
            "Watch this",
            str(tmp_path / "output.mp4"),
            style="streamer",
            facecam_size="large",
        )

    filter_arg = next(arg for arg in ffmpeg_calls[0] if "overlay=" in arg)
    assert "overlay=390:833" in filter_arg
