import json
import shutil
from unittest.mock import patch
from pathlib import Path

import pytest

from python_worker import (
    _legacy_api,
    build_clip_generation_command,
    build_clip_render_command,
    build_clip_generation_environment,
    handle_request,
    load_generation_result,
    cleanup_generation_scratch,
    cleanup_uploaded_clip_files,
    _run_clip_generation,
    _persist_clip_url,
    upload_generation_artifacts,
    parse_request,
)


def test_handle_request_generates_clip_info_with_source_context(monkeypatch, capsys):
    from types import SimpleNamespace

    seen = {}
    config = SimpleNamespace(
        is_gemini=lambda: False,
        api_key="",
        analyze_model="analyze-model",
        text_model="text-model",
    )

    monkeypatch.setattr("ai_client.load_ai_config", lambda headers: config)

    def fake_chat_json(_config, prompt, **_kwargs):
        seen["prompt"] = prompt
        return {
            "video_title_for_youtube_short": "Rubius compra el upgrade final del arma en Meltopia",
            "video_description_for_tiktok": "Rubius compra el último upgrade del arma 🔥",
            "video_description_for_instagram": "Rubius desbloquea la mejora final 😭🔥",
            "viral_hook_text": "ESTO LO CAMBIA TODO",
        }

    monkeypatch.setattr("ai_client.chat_json", fake_chat_json)

    handle_request(
        {
            "id": "clip-info-1",
            "operation": "clip_info",
            "payload": {
                "title": "Old title from previous time range",
                "caption": "Old caption from previous time range",
                "instagram_caption": "Old Instagram caption from previous time range",
                "subtitle_text": "Texto editado del rango actual",
                "trim_start_seconds": 120,
                "trim_end_seconds": 158,
                "source_metadata": {
                    "title": "Rubius juega Meltopia",
                    "channel": "Rubius",
                },
                "source_context": {"what": "Meltopia upgrade"},
            },
            "headers": {},
        }
    )

    event = json.loads(capsys.readouterr().out.strip())
    assert event["result"]["video_title_for_youtube_short"].startswith("Rubius compra")
    assert "Texto editado del rango actual" in seen["prompt"]
    assert "Rubius juega Meltopia" in seen["prompt"]
    assert "Meltopia upgrade" in seen["prompt"]
    assert "120" in seen["prompt"] and "158" in seen["prompt"]
    assert "SELECTED CONTENT" in seen["prompt"]
    assert "authoritative" in seen["prompt"].lower()
    assert "Old title from previous time range" not in seen["prompt"]
    assert "Old caption from previous time range" not in seen["prompt"]
    assert "Old Instagram caption from previous time range" not in seen["prompt"]


def test_handle_request_generates_hashtags_with_source_metadata(monkeypatch, capsys):
    from types import SimpleNamespace

    seen = {}
    config = SimpleNamespace(
        is_gemini=lambda: False,
        api_key="",
        analyze_model="analyze-model",
        text_model="text-model",
    )
    monkeypatch.setattr("ai_client.load_ai_config", lambda headers: config)

    def fake_chat_json(_config, prompt, **_kwargs):
        seen["prompt"] = prompt
        return {"hashtags": ["#Meltopia", "#Rubius"]}

    monkeypatch.setattr("ai_client.chat_json", fake_chat_json)
    handle_request(
        {
            "id": "hashtags-1",
            "operation": "hashtags",
            "payload": {
                "title": "Rubius compra el upgrade final",
                "caption": "Compra el último upgrade 🔥",
                "subtitle_text": "Texto actual",
                "source_metadata": {"channel": "Rubius", "tags": ["Meltopia"]},
                "source_context": {"what": "upgrade final"},
            },
            "headers": {},
        }
    )

    event = json.loads(capsys.readouterr().out.strip())
    assert event["result"]["hashtags"] == ["#Meltopia", "#Rubius"]
    assert "SOURCE METADATA" in seen["prompt"]
    assert "Rubius" in seen["prompt"]
    assert "SOURCE CONTEXT" in seen["prompt"]


def test_parse_request_requires_id_and_operation():
    with pytest.raises(ValueError, match="request id is required"):
        parse_request(json.dumps({"operation": "clip_generation"}))


def test_build_clip_generation_command_preserves_job_inputs():
    request = parse_request(
        json.dumps(
            {
                "id": "job-1",
                "operation": "clip_generation",
                "source_url": "https://example.com/video.mp4",
                "output_dir": "output/job-1",
                "clip_count": 4,
                "source_context_url": "https://example.com/source",
            }
        )
    )

    assert build_clip_generation_command(request) == [
        "-u",
        "main.py",
        "--direct-url",
        "https://example.com/video.mp4",
        "--source-url",
        "https://example.com/source",
        "--target-clips",
        "4",
        "--keep-original",
        "-o",
        "output/job-1",
    ]


def test_build_clip_generation_command_forwards_streamer_layout_options():
    request = parse_request(
        json.dumps(
            {
                "id": "job-1",
                "operation": "clip_generation",
                "source_path": "source.mp4",
                "output_dir": "output/job-1",
                "layout_format": "streamer_stack",
                "facecam_size": "large",
            }
        )
    )

    command = build_clip_generation_command(request)

    assert command[command.index("--layout-format") + 1] == "streamer_stack"
    assert command[command.index("--facecam-size") + 1] == "large"


def test_build_clip_generation_command_supports_deferred_discovery():
    request = parse_request(
        json.dumps(
            {
                "id": "job-1",
                "operation": "clip_generation",
                "source_path": "source.mp4",
                "output_dir": "output/job-1",
                "defer_render": True,
            }
        )
    )

    command = build_clip_generation_command(request)

    assert "--defer-render" in command


def test_build_clip_render_command_targets_one_clip():
    request = parse_request(
        json.dumps(
            {
                "id": "render-1",
                "operation": "clip_render",
                "source_path": "output/job-1/source.mp4",
                "output_dir": "output/job-1",
                "clip_index": 2,
                "layout_format": "streamer_stack",
                "facecam_size": "large",
            }
        )
    )

    command = build_clip_render_command(request)

    assert command == [
        "-u",
        "main.py",
        "--input",
        "output/job-1/source.mp4",
        "--render-clip",
        "2",
        "--layout-format",
        "streamer_stack",
        "--facecam-size",
        "large",
        "-o",
        "output/job-1",
    ]


def test_build_clip_generation_command_rejects_missing_source():
    request = parse_request(
        json.dumps(
            {
                "id": "job-1",
                "operation": "clip_generation",
                "output_dir": "output/job-1",
            }
        )
    )

    with pytest.raises(ValueError, match="exactly one source"):
        build_clip_generation_command(request)


def test_clip_generation_environment_uses_request_ai_headers(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "lmstudio")

    environment = build_clip_generation_environment(
        {
            "headers": {
                "X-AI-Provider": "openrouter",
                "X-AI-Api-Key": "secret",
                "X-AI-Base-Url": "https://openrouter.ai/api/v1",
                "X-AI-Analyze-Model": "openai/gpt-4o-mini",
            }
        }
    )

    assert environment["AI_PROVIDER"] == "openrouter"
    assert environment["AI_API_KEY"] == "secret"
    assert environment["AI_BASE_URL"] == "https://openrouter.ai/api/v1"
    assert environment["AI_ANALYZE_MODEL"] == "openai/gpt-4o-mini"


def test_handle_request_dispatches_highlight_generation(monkeypatch, capsys, tmp_path):
    calls = []

    def fake_run(request, emit_log):
        calls.append((request, emit_log))
        emit_log("selected highlight")
        return {"video_url": "/videos/job-1/highlights.mp4"}

    monkeypatch.setattr("highlight_generation.run_highlight_generation", fake_run)
    handle_request({"id": "job-1", "operation": "highlight_generation", "output_dir": str(tmp_path)})

    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert events[0]["type"] == "started"
    assert events[1]["type"] == "log"
    assert events[-1]["type"] == "result"
    assert calls[0][0]["id"] == "job-1"


def test_load_generation_result_reads_metadata_for_go_status_api():
    output_dir = Path(".cache") / "python-worker-test"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        (output_dir / "source_metadata.json").write_text(
            json.dumps(
                {
                    "source_metadata": {
                        "platform": "youtube",
                        "title": "Source video",
                    },
                    "shorts": [{"title": "First clip"}],
                    "cost_analysis": {"total": 1.2},
                }
            ),
            encoding="utf-8",
        )

        assert load_generation_result(str(output_dir)) == {
            "source_metadata": {
                "platform": "youtube",
                "title": "Source video",
            },
            "clips": [{"title": "First clip"}],
            "cost_analysis": {"total": 1.2},
        }
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)


def test_upload_generation_artifacts_publishes_job_output_to_s3(monkeypatch, tmp_path):
    uploaded = []

    def fake_upload(directory, job_id):
        uploaded.append((directory, job_id))
        return True

    monkeypatch.setenv("AWS_S3_BUCKET", "openshorts-media")
    monkeypatch.setattr("s3_uploader.upload_job_artifacts", fake_upload)

    assert upload_generation_artifacts(str(tmp_path), "job-1") is True

    assert uploaded == [(str(tmp_path), "job-1")]


def test_upload_generation_artifacts_is_disabled_without_s3_bucket(monkeypatch, tmp_path):
    uploaded = []
    monkeypatch.delenv("AWS_S3_BUCKET", raising=False)
    monkeypatch.setattr("s3_uploader.upload_job_artifacts", lambda *_args: uploaded.append(True))

    assert upload_generation_artifacts(str(tmp_path), "job-1") is False

    assert uploaded == []


def test_cleanup_generation_scratch_removes_only_job_scoped_directory(tmp_path):
    job_root = tmp_path / "job-1"
    job_root.mkdir()
    (job_root / "source.mp4").write_bytes(b"video")

    cleanup_generation_scratch(str(job_root), "job-1")

    assert not job_root.exists()


def test_cleanup_generation_scratch_preserves_selected_source(tmp_path):
    job_root = tmp_path / "job-1"
    job_root.mkdir()
    source = job_root / "source.mp4"
    source.write_bytes(b"source")
    (job_root / "source_metadata.json").write_text("{}", encoding="utf-8")
    (job_root / "rendered_clip.mp4").write_bytes(b"clip")
    scratch = job_root / "manifests"
    scratch.mkdir()
    (scratch / "clip.json").write_text("{}", encoding="utf-8")

    cleanup_generation_scratch(str(job_root), "job-1", preserve_paths=[str(source)])

    assert source.read_bytes() == b"source"
    assert not (job_root / "source_metadata.json").exists()
    assert not (job_root / "rendered_clip.mp4").exists()
    assert not scratch.exists()


def test_clip_generation_cleanup_retains_master_source(tmp_path, monkeypatch):
    output_dir = tmp_path / "job-1"
    output_dir.mkdir()
    source = output_dir / "source.mp4"
    source.write_bytes(b"master")
    metadata = output_dir / "source_metadata.json"
    metadata.write_text("{}", encoding="utf-8")

    class FakeProcess:
        stdout = iter(())

        def wait(self):
            return 0

    monkeypatch.setattr("python_worker.subprocess.Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr("python_worker.load_generation_result", lambda _directory: {"clips": []})
    monkeypatch.setattr("python_worker.upload_generation_artifacts", lambda *args, **kwargs: True)

    _run_clip_generation(
        {
            "id": "job-1",
            "operation": "clip_generation",
            "output_dir": str(output_dir),
            "source_url": "https://example.com/source.mp4",
        }
    )

    assert source.read_bytes() == b"master"
    assert metadata.exists()


def test_clip_generation_cleanup_removes_clips_but_retains_master_cache(tmp_path, monkeypatch):
    output_dir = tmp_path / "job-1"
    output_dir.mkdir()
    source = output_dir / "source.mp4"
    source.write_bytes(b"master")
    metadata = output_dir / "source_metadata.json"
    metadata.write_text("{}", encoding="utf-8")
    master = output_dir / "master_8_version_123.mp4"
    master.write_bytes(b"rendered master cache")
    clip = output_dir / "source_clip_1.mp4"
    clip.write_bytes(b"published clip")

    class FakeProcess:
        stdout = iter(())

        def wait(self):
            return 0

    monkeypatch.setattr("python_worker.subprocess.Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr(
        "python_worker.load_generation_result",
        lambda _directory: {"clips": [{"video_filename": "source_clip_1.mp4"}]},
    )
    monkeypatch.setattr("python_worker.upload_generation_artifacts", lambda *args, **kwargs: True)

    _run_clip_generation(
        {
            "id": "job-1",
            "operation": "clip_generation",
            "output_dir": str(output_dir),
            "source_url": "https://example.com/source.mp4",
        }
    )

    assert source.exists()
    assert metadata.exists()
    assert master.exists()
    assert not clip.exists()


def test_uploaded_clip_cleanup_preserves_range_render_cache(tmp_path):
    output_dir = tmp_path / "job-1"
    output_dir.mkdir()
    cache = output_dir / "render-cache" / "clip-range.mp4"
    cache.parent.mkdir()
    cache.write_bytes(b"range proxy")
    published_clip = output_dir / "source_clip_1.mp4"
    published_clip.write_bytes(b"published clip")

    cleanup_uploaded_clip_files(str(output_dir), "job-1")

    assert cache.exists()
    assert not published_clip.exists()


def test_upload_generation_artifacts_forwards_exclusions(monkeypatch, tmp_path):
    calls = []

    def fake_upload(directory, job_id, excluded_paths=None):
        calls.append((directory, job_id, excluded_paths))
        return True

    monkeypatch.setenv("AWS_S3_BUCKET", "openshorts-media")
    monkeypatch.setattr("s3_uploader.upload_job_artifacts", fake_upload)

    assert upload_generation_artifacts(str(tmp_path), "job-1", {"source.mp4"}) is True
    assert calls == [(str(tmp_path), "job-1", {"source.mp4"})]


def test_upload_generation_artifacts_forwards_clip_scope(monkeypatch, tmp_path):
    calls = []

    def fake_upload(directory, job_id, excluded_paths=None, include_paths=None, clip_id=None):
        calls.append((directory, job_id, excluded_paths, include_paths, clip_id))
        return True

    monkeypatch.setenv("AWS_S3_BUCKET", "openshorts-media")
    monkeypatch.setattr("s3_uploader.upload_job_artifacts", fake_upload)

    assert upload_generation_artifacts(
        str(tmp_path),
        "job-1",
        excluded_paths={"source.mp4"},
        include_paths={"source_clip_2.mp4"},
        clip_id="clip-2",
    ) is True
    assert calls == [
        (str(tmp_path), "job-1", {"source.mp4"}, {"source_clip_2.mp4"}, "clip-2")
    ]


def test_persist_clip_url_keeps_render_job_id_for_clip_artifact_scope(tmp_path):
    metadata = {"shorts": [{"video_filename": "remotion_8_1787260172918.mp4"}]}
    metadata_path = tmp_path / "source_metadata.json"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

    _persist_clip_url(
        tmp_path,
        metadata,
        0,
        "/videos/job-1/remotion_8_1787260172918.mp4",
        render_job_id="clip-render-1",
    )

    persisted = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert persisted["shorts"][0]["render_job_id"] == "clip-render-1"


def test_thumbnail_publish_status_returns_persisted_result():
    tmp_path = Path(".cache") / "python-worker-publish-test"
    tmp_path.mkdir(parents=True, exist_ok=True)
    state = {"status": "done", "result": {"upload_id": "upload-1"}, "error": None}
    try:
        (tmp_path / ".thumbnail_publish_publish-1.json").write_text(json.dumps(state), encoding="utf-8")

        result = _legacy_api(
            {
                "payload": {"action": "thumbnail_publish_status", "publish_id": "publish-1"},
                "output_dir": str(tmp_path),
                "headers": {},
            }
        )

        assert result == state
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)


def test_thumbnail_publish_uses_caller_supplied_publish_id():
    tmp_path = Path(".cache") / "python-worker-publish-id-test"
    tmp_path.mkdir(parents=True, exist_ok=True)
    try:
        video_path = tmp_path / "source.mp4"
        video_path.write_bytes(b"video")
        thumbnail_path = tmp_path / "thumbnails" / "session-1" / "thumb.jpg"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"thumbnail")
        (tmp_path / ".thumbnail_sessions.json").write_text(
            json.dumps({"session-1": {"video_path": str(video_path)}}), encoding="utf-8"
        )

        class FakeResponse:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"upload_id": "upload-1"}

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            @staticmethod
            def post(*_args, **_kwargs):
                return FakeResponse()

        with patch("httpx.Client", return_value=FakeClient()):
            result = _legacy_api(
                {
                    "payload": {
                        "action": "thumbnail_publish",
                        "session_id": "session-1",
                        "publish_id": "publish-1",
                        "thumbnail_url": "/thumbnails/session-1/thumb.jpg",
                        "api_key": "key",
                        "user_id": "user",
                    },
                    "output_dir": str(tmp_path),
                    "headers": {},
                }
            )

        assert result["publish_id"] == "publish-1"
        assert (tmp_path / ".thumbnail_publish_publish-1.json").is_file()
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)
