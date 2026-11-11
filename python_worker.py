"""LEGACY JSON-lines worker bridge for media and AI workloads.

The Go control plane owns HTTP. This process accepts one or more newline-delimited
job requests on stdin and emits newline-delimited lifecycle events on stdout.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from openshorts.observability.audit_capture import get_audit_emitter


def parse_request(line: str) -> dict[str, Any]:
    try:
        request = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ValueError("request must be valid JSON") from exc
    if not isinstance(request, dict):
        raise ValueError("request must be a JSON object")
    if not str(request.get("id") or "").strip():
        raise ValueError("request id is required")
    if not str(request.get("operation") or "").strip():
        raise ValueError("request operation is required")
    return request


def build_clip_generation_command(request: Mapping[str, Any]) -> list[str]:
    sources = [
        ("source_url", request.get("source_url")),
        ("source_path", request.get("source_path")),
        ("source_object", request.get("source_object")),
    ]
    provided = [(name, value) for name, value in sources if value]
    if len(provided) != 1:
        raise ValueError("exactly one source is required")

    name, value = provided[0]
    command = ["-u", "main.py"]
    if name == "source_url":
        command.extend(["--direct-url", str(value)])
    elif name == "source_path":
        command.extend(["--input", str(value)])
    else:
        command.extend(["--source-object", json.dumps(value, separators=(",", ":"))])

    source_context_url = str(request.get("source_context_url") or "").strip()
    if source_context_url:
        command.extend(["--source-url", source_context_url])

    clip_count = int(request.get("clip_count") or 6)
    command.extend(["--target-clips", str(clip_count)])
    layout_format = str(request.get("layout_format") or "").strip()
    facecam_size = str(request.get("facecam_size") or "").strip()
    if layout_format or facecam_size:
        command.extend([
            "--layout-format",
            layout_format or "standard",
            "--facecam-size",
            facecam_size or "medium",
        ])
    if bool(request.get("defer_render")):
        command.append("--defer-render")
    if name != "source_object":
        command.append("--keep-original")
    command.extend(["-o", str(request.get("output_dir") or "")])
    return command


def build_clip_render_command(request: Mapping[str, Any]) -> list[str]:
    source_path = str(request.get("source_path") or "").strip()
    if not source_path:
        raise ValueError("clip render source path is required")
    try:
        clip_index = int(request.get("clip_index"))
    except (TypeError, ValueError) as exc:
        raise ValueError("clip render index is required") from exc
    if clip_index < 0:
        raise ValueError("clip render index must be non-negative")

    command = ["-u", "main.py", "--input", source_path, "--render-clip", str(clip_index)]
    layout_format = str(request.get("layout_format") or "").strip()
    facecam_size = str(request.get("facecam_size") or "").strip()
    if layout_format or facecam_size:
        command.extend([
            "--layout-format",
            layout_format or "standard",
            "--facecam-size",
            facecam_size or "medium",
        ])
    command.extend(["-o", str(request.get("output_dir") or "")])
    return command


def load_generation_result(output_dir: str) -> dict[str, Any]:
    metadata_files = sorted(Path(output_dir).glob("*_metadata.json"))
    if not metadata_files:
        raise FileNotFoundError("No metadata file generated")
    with metadata_files[0].open("r", encoding="utf-8") as source:
        data = json.load(source)
    result = {
        "clips": data.get("shorts", []),
        "cost_analysis": data.get("cost_analysis"),
    }
    for key in (
        "source_path",
        "source_asset",
        "source_object",
        "source_metadata",
        "video_title",
        "transcript",
    ):
        if key in data:
            result[key] = data[key]
    return result


def upload_generation_artifacts(output_dir: str, job_id: str, excluded_paths=None, include_paths=None, clip_id=None) -> bool:
    """Publish generated media to the configured MinIO/S3 output bucket."""
    if not str(os.environ.get("AWS_S3_BUCKET") or "").strip():
        return False
    from openshorts.storage.s3_uploader import upload_job_artifacts

    if excluded_paths or include_paths or clip_id:
        upload_options = {}
        if excluded_paths is not None:
            upload_options["excluded_paths"] = excluded_paths
        if include_paths is not None:
            upload_options["include_paths"] = include_paths
        if clip_id is not None:
            upload_options["clip_id"] = clip_id
        return bool(upload_job_artifacts(output_dir, job_id, **upload_options))
    return bool(upload_job_artifacts(output_dir, job_id))


def cleanup_generation_scratch(output_dir: str, job_id: str, preserve_paths=None) -> None:
    """Remove completed job scratch while retaining explicitly preserved files."""
    job_id = str(job_id or "").strip()
    output_path = Path(output_dir).resolve()
    if not job_id or output_path.name != job_id:
        raise ValueError("refusing to remove a non-job-scoped output directory")
    preserved = {Path(path).resolve() for path in (preserve_paths or [])}
    if not preserved:
        shutil.rmtree(output_path)
        return
    for child in output_path.iterdir():
        if child.resolve() in preserved:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def cleanup_uploaded_clip_files(output_dir: str, job_id: str, preserve_paths=None) -> None:
    """Remove published clip videos while retaining the local rendering cache."""
    job_id = str(job_id or "").strip()
    output_path = Path(output_dir).resolve()
    if not job_id or output_path.name != job_id:
        raise ValueError("refusing to clean a non-job-scoped output directory")

    preserved = {Path(path).resolve() for path in (preserve_paths or [])}
    for candidate in output_path.rglob("*"):
        if not candidate.is_file() or candidate.resolve() in preserved:
            continue
        if "render-cache" in candidate.relative_to(output_path).parts:
            continue
        if candidate.name == "source.mp4" or candidate.name.endswith("_metadata.json"):
            continue
        if candidate.name.startswith("master_") and candidate.suffix.lower() == ".mp4":
            continue
        if candidate.suffix.lower() == ".mp4":
            candidate.unlink()


def build_clip_generation_environment(request: Mapping[str, Any]) -> dict[str, str]:
    """Apply per-job AI settings without replacing the configured transcription model."""
    from openshorts.ai.ai_client import ai_config_to_env, load_ai_config

    environment = os.environ.copy()
    headers = request.get("headers") or {}
    if headers:
        request_environment = ai_config_to_env(load_ai_config(headers))
        # UI chat headers can carry a stale model from a different ASR provider.
        request_environment.pop("AI_TRANSCRIPTION_MODEL", None)
        request_environment.pop("AI_TRANSCRIPTION_OPENROUTER_PROVIDER", None)
        environment.update(request_environment)
    for key, value in (request.get("environment") or {}).items():
        if value is not None:
            environment[str(key)] = str(value)
    return environment


def _emit(event: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(dict(event), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def forward_child_output_line(request_id: str, line: str, emit=_emit) -> bool:
    """Forward child audit protocol records and wrap all other output as logs."""
    text = str(line).rstrip("\r\n")
    try:
        event = json.loads(text)
    except json.JSONDecodeError:
        event = None
    if isinstance(event, dict) and event.get("type") == "audit" and isinstance(event.get("audit"), dict):
        emit({"id": request_id, **event})
        return True
    emit({"id": request_id, "type": "log", "message": text})
    return False


def _run_clip_generation(request: Mapping[str, Any]) -> tuple[int, dict[str, Any] | None]:
    output_dir = str(request.get("output_dir") or "")
    artifact_job_id = str(request.get("parent_job_id") or request["id"])
    operation = str(request.get("operation") or "")
    source_path = str(request.get("source_path") or "").strip()
    excluded_paths = set()
    output_root = Path(output_dir).resolve()
    preserve_paths = [str(output_root / "source.mp4")]
    if operation == "clip_render" and source_path:
        candidate = Path(source_path).resolve()
        try:
            excluded_paths.add(candidate.relative_to(output_root).as_posix())
            preserve_paths.append(str(candidate))
        except ValueError:
            pass
    emitter = get_audit_emitter()
    with emitter.stage("source.download", metadata={"operation": operation}):
        if operation == "clip_render":
            from openshorts.storage.s3_uploader import hydrate_job_artifacts

            hydrate_job_artifacts(output_dir, artifact_job_id)
    command = (
        build_clip_render_command(request)
        if operation == "clip_render"
        else build_clip_generation_command(request)
    )
    environment = build_clip_generation_environment(request)

    process = subprocess.Popen(
        [sys.executable, *command],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=environment,
    )
    assert process.stdout is not None
    for line in process.stdout:
        forward_child_output_line(str(request["id"]), line)
    exit_code = process.wait()
    if exit_code != 0:
        return exit_code, None
    result = load_generation_result(output_dir)
    include_paths = None
    clip_id = None
    if operation == "clip_render":
        clip_index = int(request.get("clip_index") or 0)
        clips = result.get("clips") or []
        clip = clips[clip_index] if clip_index < len(clips) else {}
        clip_filename = clip.get("video_filename") or f"source_clip_{clip_index + 1}.mp4"
        include_paths = {clip_filename}
        clip_id = str(request["id"])
    with emitter.stage("artifact.upload", metadata={"job_id": artifact_job_id}):
        uploaded = upload_generation_artifacts(
            output_dir,
            artifact_job_id,
            excluded_paths=excluded_paths or None,
            include_paths=include_paths,
            clip_id=clip_id,
        )
    if uploaded:
        with emitter.stage("scratch.cleanup", metadata={"job_id": artifact_job_id}):
            cleanup_uploaded_clip_files(
                output_dir,
                artifact_job_id,
                preserve_paths=preserve_paths or None,
            )
    return exit_code, result


def _output_root(request: Mapping[str, Any]) -> Path:
    root = Path(str(request.get("output_dir") or "output"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _job_paths(payload: Mapping[str, Any], root: Path) -> tuple[Path, dict[str, Any], int]:
    job_id = str(payload.get("job_id") or "").strip()
    clip_index = int(payload.get("clip_index") or 0)
    if not job_id:
        raise ValueError("job_id is required")
    job_root = root / job_id
    metadata_files = sorted(job_root.glob("*_metadata.json"))
    if not metadata_files:
        raise FileNotFoundError("Metadata not found")
    with metadata_files[0].open("r", encoding="utf-8") as source:
        metadata = json.load(source)
    clips = metadata.get("shorts") or []
    if clip_index < 0 or clip_index >= len(clips):
        raise IndexError("Clip not found")
    clip = clips[clip_index]
    filename = str(payload.get("input_filename") or "").strip()
    if not filename:
        video_url = str(clip.get("video_url") or "")
        filename = Path(video_url.split("?")[0]).name if video_url else str(clip.get("video_filename") or "")
    if not filename or Path(filename).name != filename:
        raise ValueError("Invalid input filename")
    input_path = job_root / filename
    if not input_path.is_file():
        raise FileNotFoundError("Video file not found")
    return input_path, metadata, clip_index


def _persist_clip_url(
    job_root: Path,
    metadata: dict[str, Any],
    clip_index: int,
    url: str,
    render_job_id: str | None = None,
) -> None:
    clip = metadata.setdefault("shorts", [])[clip_index]
    clip["video_url"] = url
    if render_job_id:
        clip["render_job_id"] = str(render_job_id).strip()
    metadata_files = sorted(job_root.glob("*_metadata.json"))
    if metadata_files:
        metadata_files[0].write_text(json.dumps(metadata, indent=4, ensure_ascii=False), encoding="utf-8")


def _legacy_api(request: Mapping[str, Any]) -> dict[str, Any]:
    payload = request.get("payload") or {}
    action = str(payload.get("action") or "")
    root = _output_root(request)

    if action == "minio_objects":
        from openshorts.storage.minio_sources import list_source_objects
        return list_source_objects(payload.get("search", ""), int(payload.get("limit") or 50), payload.get("continuation_token"))

    if action == "clip_video_url":
        job_root, metadata, clip_index = None, None, int(payload.get("clip_index") or 0)
        job_root_path = root / str(payload.get("job_id") or "")
        metadata_files = sorted(job_root_path.glob("*_metadata.json"))
        if not metadata_files:
            raise FileNotFoundError("Metadata not found")
        metadata = json.loads(metadata_files[0].read_text(encoding="utf-8"))
        if clip_index < 0 or clip_index >= len(metadata.get("shorts") or []):
            raise IndexError("Clip not found")
        url = str(payload.get("new_video_url") or "").strip()
        if not url:
            raise ValueError("new_video_url is required")
        _persist_clip_url(
            job_root_path,
            metadata,
            clip_index,
            url,
            render_job_id=payload.get("render_job_id"),
        )
        return {"success": True, "job_id": payload["job_id"], "clip_index": clip_index, "video_url": url}

    if action in {"subtitle", "hook", "translate"}:
        input_path, metadata, clip_index = _job_paths(payload, root)
        job_id = str(payload["job_id"])
        job_root = root / job_id
        if action == "subtitle":
            from openshorts.subtitles.subtitles import burn_subtitles, generate_srt, generate_srt_from_video
            output_name = f"subtitled_{input_path.name}"
            srt_path = job_root / f"subs_{clip_index}_{int(time.time())}.srt"
            output_path = job_root / output_name
            transcript = metadata.get("transcript")
            clip = metadata["shorts"][clip_index]
            if input_path.name.startswith("translated_"):
                ok = generate_srt_from_video(
                    str(input_path),
                    str(srt_path),
                    headers=request.get("headers") if isinstance(request.get("headers"), Mapping) else None,
                )
            else:
                ok = generate_srt(transcript, clip.get("start", 0), clip.get("end", 0), str(srt_path))
            if not ok:
                raise ValueError("No words found for this clip range.")
            burn_subtitles(str(input_path), str(srt_path), str(output_path), alignment=payload.get("position", "bottom"), fontsize=int(payload.get("font_size") or 16), font_name=str(payload.get("font_name") or "Verdana"), font_color=str(payload.get("font_color") or "#FFFFFF"), border_color=str(payload.get("border_color") or "#000000"), border_width=int(payload.get("border_width") or 2), bg_color=str(payload.get("bg_color") or "#000000"), bg_opacity=float(payload.get("bg_opacity") or 0))
            srt_path.unlink(missing_ok=True)
        elif action == "hook":
            from openshorts.media.hooks import add_hook_to_video, hook_style_for_layout
            output_name = f"hook_{input_path.name}"
            output_path = job_root / output_name
            scale = {"S": 0.8, "M": 1.0, "L": 1.3}.get(str(payload.get("size") or "M"), 1.0)
            clip = metadata["shorts"][clip_index]
            add_hook_to_video(
                str(input_path),
                str(payload.get("text") or ""),
                str(output_path),
                position=str(payload.get("position") or "top"),
                font_scale=scale,
                style=hook_style_for_layout(clip.get("layout_format")),
                facecam_size=clip.get("facecam_size", "medium"),
            )
        else:
            from openshorts.integrations.translate import translate_video
            target = str(payload.get("target_language") or "").strip()
            if not target or not str(request.get("headers", {}).get("X-ElevenLabs-Key") or ""):
                raise ValueError("Missing X-ElevenLabs-Key header")
            output_name = f"translated_{target}_{input_path.stem}{input_path.suffix}"
            output_path = job_root / output_name
            translate_video(str(input_path), str(output_path), target, str(request["headers"]["X-ElevenLabs-Key"]), payload.get("source_language"))
        url = f"/videos/{job_id}/{output_name}"
        _persist_clip_url(job_root, metadata, clip_index, url)
        return {"success": True, "new_video_url": url}

    if action == "edit":
        input_path, metadata, clip_index = _job_paths(payload, root)
        from openshorts.workflows.editor import VideoEditor
        from openshorts.ai.ai_client import load_ai_config
        config = load_ai_config(request.get("headers") or {})
        editor = VideoEditor(api_key_or_config=config)
        output_name = f"edited_{input_path.name}"
        output_path = input_path.parent / output_name
        safe_input = input_path.parent / f"temp_input_{uuid.uuid4().hex}.mp4"
        safe_output = input_path.parent / f"temp_output_{uuid.uuid4().hex}.mp4"
        try:
            import shutil
            shutil.copy(input_path, safe_input)
            video = editor.upload_video(str(safe_input))
            plan = editor.get_ffmpeg_filter(video, 0, transcript=metadata.get("transcript"))
            editor.apply_edits(str(safe_input), str(safe_output), plan)
            shutil.move(str(safe_output), str(output_path))
        finally:
            safe_input.unlink(missing_ok=True); safe_output.unlink(missing_ok=True)
        url = f"/videos/{payload['job_id']}/{output_name}"
        return {"success": True, "new_video_url": url, "edit_plan": plan}

    if action == "effects":
        input_path, metadata, _ = _job_paths(payload, root)
        from openshorts.ai.ai_client import load_ai_config
        from openshorts.workflows.editor import VideoEditor
        editor = VideoEditor(api_key_or_config=load_ai_config(request.get("headers") or {}))
        return {"effects": editor.get_effects_config(editor.upload_video(str(input_path)), 0, transcript=metadata.get("transcript"))}

    if action == "subtitle_track_translate":
        from openshorts.subtitles.translation_worker import perform_translation
        body = dict(payload)
        body.pop("action", None)
        return perform_translation(body, request.get("headers") or {})

    if action == "social_post":
        import httpx
        input_path, metadata, clip_index = _job_paths(payload, root)
        clip = metadata["shorts"][clip_index]
        api_key = str(payload.get("api_key") or "")
        if not api_key:
            raise ValueError("api_key is required")
        platforms = payload.get("platforms") or []
        title = payload.get("title") or clip.get("title") or "Viral Short"
        description = payload.get("description") or clip.get("video_description_for_instagram") or clip.get("video_description_for_tiktok") or "Check this out!"
        data = {"user": payload.get("user_id"), "title": title, "platform[]": platforms, "async_upload": "true"}
        if payload.get("scheduled_date"):
            data["scheduled_date"] = payload["scheduled_date"]
            data["timezone"] = payload.get("timezone") or "UTC"
        if "tiktok" in platforms: data["tiktok_title"] = description
        if "instagram" in platforms: data.update({"instagram_title": description, "media_type": "REELS"})
        if "youtube" in platforms: data.update({"youtube_title": payload.get("title") or clip.get("video_title_for_youtube_short", title), "youtube_description": description, "privacyStatus": "public"})
        with input_path.open("rb") as video:
            response = httpx.post("https://api.upload-post.com/api/upload", headers={"Authorization": f"Apikey {api_key}"}, data=data, files={"video": (input_path.name, video, "video/mp4")}, timeout=120)
        if response.status_code not in {200, 201, 202}:
            raise RuntimeError(f"Vendor API Error: {response.text}")
        return response.json()

    raise ValueError(f"unsupported legacy action: {action}")


def handle_request(request: Mapping[str, Any]) -> None:
    request_id = str(request["id"])
    operation = str(request["operation"])
    try:
        if operation == "translation":
            from openshorts.subtitles.translation_worker import perform_translation

            track = perform_translation(request.get("payload") or {}, request.get("headers") or {})
            _emit({"id": request_id, "type": "result", "result": {"track": track}})
            return
        if operation == "transcribe":
            from openshorts.subtitles.local_editor_subtitles import word_captions_from_transcript
            from openshorts.subtitles.subtitles import build_subtitle_segments, transcribe_audio

            source_path = str((request.get("payload") or {}).get("source_path") or "").strip()
            if not source_path:
                raise ValueError("transcription source path is required")
            transcription_payload = request.get("payload") or {}
            start_seconds = float(transcription_payload.get("start_seconds") or 0.0)
            end_value = transcription_payload.get("end_seconds")
            end_seconds = float(end_value) if end_value is not None else None
            transcript = transcribe_audio(
                source_path,
                headers=request.get("headers") if isinstance(request.get("headers"), Mapping) else None,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
            )
            _emit({
                "id": request_id,
                "type": "result",
                "result": {
                    "language": transcript.get("language", "und"),
                    "captions": word_captions_from_transcript(transcript),
                    "segments": build_subtitle_segments(transcript, 0, float("inf")),
                },
            })
            return
        if operation == "codex_status":
            from openshorts.ai.codex_auth import default_codex_store

            pending_path = Path(str(request.get("output_dir") or "output")) / ".codex-pending.json"
            status = default_codex_store().status()
            status["pending"] = pending_path.is_file()
            _emit({"id": request_id, "type": "result", "result": status})
            return
        if operation == "codex_disconnect":
            from openshorts.ai.codex_auth import default_codex_store

            default_codex_store().clear()
            _emit({"id": request_id, "type": "result", "result": {"connected": False, "pending": False}})
            return
        if operation == "codex_models":
            from openshorts.ai.ai_client import discover_codex_models

            discovered = discover_codex_models()
            _emit({"id": request_id, "type": "result", "result": {
                "provider": "openai-codex",
                "models": discovered.get("models", []),
                "defaultModel": discovered.get("defaultModel", ""),
            }})
            return
        if operation == "codex_connect":
            from openshorts.ai.codex_auth import start_device_login

            root = _output_root(request)
            pending = start_device_login().pending
            (root / ".codex-pending.json").write_text(json.dumps({"device_auth_id": pending.device_auth_id, "user_code": pending.user_code, "interval_seconds": pending.interval_seconds, "started_at": pending.started_at}), encoding="utf-8")
            _emit({"id": request_id, "type": "result", "result": {"status": "pending", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": pending.user_code, "intervalSeconds": pending.interval_seconds}})
            return
        if operation == "codex_poll":
            from openshorts.ai.codex_auth import PendingDeviceLogin, default_codex_store, poll_device_login_once

            root = _output_root(request)
            pending_path = root / ".codex-pending.json"
            if not pending_path.is_file():
                _emit({"id": request_id, "type": "result", "result": default_codex_store().status()})
                return
            pending_data = json.loads(pending_path.read_text(encoding="utf-8"))
            pending = PendingDeviceLogin(device_auth_id=pending_data["device_auth_id"], user_code=pending_data["user_code"], interval_seconds=int(pending_data.get("interval_seconds", 5)), started_at=float(pending_data["started_at"]))
            result = poll_device_login_once(pending)
            if result.status == "connected" and result.credentials is not None:
                default_codex_store().save(result.credentials)
                pending_path.unlink(missing_ok=True)
                value = {"status": "connected", "connected": True, "pending": False}
            elif result.status in {"expired", "error"}:
                pending_path.unlink(missing_ok=True)
                value = {"status": result.status, "connected": False, "pending": False, "error": result.error}
            else:
                value = {"status": "pending", "connected": False, "pending": True}
            _emit({"id": request_id, "type": "result", "result": value})
            return
        if operation == "clip_info":
            from openshorts.ai.ai_client import chat_json, load_ai_config

            payload = request.get("payload") or {}
            headers = request.get("headers") or {}
            config = load_ai_config(headers)
            if config.is_gemini() and not config.api_key:
                raise ValueError("Missing X-Gemini-Key header")
            source_metadata = payload.get("source_metadata") or {}
            if isinstance(source_metadata, Mapping):
                source_metadata = {
                    key: value
                    for key in ("title", "channel", "categories")
                    if (value := source_metadata.get(key)) is not None
                }
            else:
                source_metadata = {}
            source_context = payload.get("source_context") or {}
            prompt = (
                "Create clip information for the selected video moment. "
                "Write in the source language. Return JSON only with exactly these keys: "
                "video_title_for_youtube_short, video_description_for_tiktok, "
                "video_description_for_instagram, viral_hook_text.\n\n"
                f"TITLE: {str(payload.get('title') or '').strip()}\n"
                f"CAPTION: {str(payload.get('caption') or '').strip()}\n"
                f"INSTAGRAM CAPTION: {str(payload.get('instagram_caption') or '').strip()}\n"
                f"SUBTITLES: {str(payload.get('subtitle_text') or '').strip()}\n"
                f"TRIM RANGE: {payload.get('trim_start_seconds', 0)}s to {payload.get('trim_end_seconds', 0)}s\n"
                f"SOURCE METADATA: {json.dumps(source_metadata, ensure_ascii=False, default=str)}\n"
                f"SOURCE CONTEXT: {json.dumps(source_context, ensure_ascii=False)}\n\n"
                "OUTPUT\n"
                '{"video_title_for_youtube_short":"...",'
                '"video_description_for_tiktok":"...",'
                '"video_description_for_instagram":"...",'
                '"viral_hook_text":"..."}'
            )
            response = chat_json(config, prompt, model=config.analyze_model or config.text_model)
            clip_info = {
                key: str(response.get(key) or "").strip()
                for key in (
                    "video_title_for_youtube_short",
                    "video_description_for_tiktok",
                    "video_description_for_instagram",
                    "viral_hook_text",
                )
            } if isinstance(response, dict) else {}
            if any(not value for value in clip_info.values()):
                raise ValueError("AI returned incomplete clip information")
            _emit({"id": request_id, "type": "result", "result": clip_info})
            return
        if operation == "hashtags":
            from openshorts.ai.ai_client import chat_json, load_ai_config

            payload = request.get("payload") or {}
            headers = request.get("headers") or {}
            config = load_ai_config(headers)
            if config.is_gemini() and not config.api_key:
                raise ValueError("Missing X-Gemini-Key header")
            source_metadata = payload.get("source_metadata") or {}
            if isinstance(source_metadata, Mapping):
                source_metadata = {
                    key: value
                    for key in ("title", "channel", "categories", "tags")
                    if (value := source_metadata.get(key)) is not None
                }
            else:
                source_metadata = {}
            prompt = (
                "Generate 8 to 12 relevant social-media hashtags. Return JSON only with "
                '{"hashtags":["#tag1"]}. Use the source language and do not return duplicates.\n\n'
                "CURRENT CLIP\n"
                f"Title: {str(payload.get('title') or '').strip()}\n"
                f"Caption: {str(payload.get('caption') or '').strip()}\n"
                f"Current subtitles: {str(payload.get('subtitle_text') or '').strip()}\n\n"
                "SOURCE METADATA\n"
                f"{json.dumps(source_metadata, ensure_ascii=False, default=str)}\n\n"
                "SOURCE CONTEXT\n"
                f"{json.dumps(payload.get('source_context') or {}, ensure_ascii=False, default=str)}"
            )
            response = chat_json(config, prompt, model=config.analyze_model or config.text_model)
            hashtags = []
            seen = set()
            for value in response.get("hashtags", []) if isinstance(response, dict) else []:
                tag = str(value).strip()
                if not tag:
                    continue
                if not tag.startswith("#"):
                    tag = "#" + tag
                key = tag.lower()
                if key not in seen:
                    seen.add(key)
                    hashtags.append(tag)
            if not hashtags:
                raise ValueError("AI returned no usable hashtags")
            _emit({"id": request_id, "type": "result", "result": {"hashtags": hashtags[:12]}})
            return
        if operation == "subtitle_reactions":
            from openshorts.ai.ai_client import chat_json, load_ai_config

            payload = request.get("payload") or {}
            headers = request.get("headers") or {}
            config = load_ai_config(headers)
            if config.is_gemini() and not config.api_key:
                raise ValueError("Missing X-Gemini-Key header")
            cues = payload.get("cues") or []
            prompt = (
                "Suggest expressive, readable emoji reactions for these subtitle cues. "
                "Return JSON only with {\"reactions\":[{\"cueIndex\":0,\"emojis\":[\"😱\"]}]}. "
                "Use zero, one, or two emojis per cue and avoid repeating the same reaction everywhere.\n\n"
                f"CUES: {json.dumps(cues, ensure_ascii=False, default=str)}"
            )
            response = chat_json(config, prompt, model=config.analyze_model or config.text_model)
            valid_indexes = set()
            for cue in cues:
                try:
                    valid_indexes.add(int(cue.get("index")))
                except (AttributeError, TypeError, ValueError):
                    continue

            reactions = []
            response_items = response.get("reactions", []) if isinstance(response, dict) else []
            for item in response_items if isinstance(response_items, list) else []:
                if not isinstance(item, Mapping):
                    continue
                try:
                    cue_index = int(item.get("cueIndex"))
                except (TypeError, ValueError):
                    continue
                emojis = []
                seen = set()
                raw_emojis = item.get("emojis", [])
                for value in raw_emojis if isinstance(raw_emojis, list) else []:
                    emoji = str(value).strip()
                    if emoji and emoji not in seen:
                        seen.add(emoji)
                        emojis.append(emoji)
                    if len(emojis) == 2:
                        break
                if cue_index in valid_indexes and emojis:
                    reactions.append({"cueIndex": cue_index, "emojis": emojis})
            if not reactions:
                raise ValueError("AI returned no usable subtitle reactions")
            _emit({"id": request_id, "type": "result", "result": {"reactions": reactions}})
            return
        if operation == "burn_subtitles":
            import uuid

            from openshorts.subtitles.local_editor_subtitles import subtitle_style_to_ffmpeg_options, write_local_editor_srt
            from openshorts.subtitles.subtitles import burn_subtitles

            payload = request.get("payload") or {}
            source_path = str(payload.get("source_path") or "").strip()
            job_id = str(payload.get("job_id") or "").strip()
            if not source_path or not job_id:
                raise ValueError("subtitle burn source and job are required")
            source = Path(source_path)
            output_dir = source.parent
            suffix = uuid.uuid4().hex[:10]
            srt_path = output_dir / f"local-editor-subtitles-{suffix}.srt"
            output_name = f"subtitled_{source.stem}_{suffix}.mp4"
            output_path = output_dir / output_name
            try:
                write_local_editor_srt(payload.get("subtitle_cues") or [], srt_path)
                options = subtitle_style_to_ffmpeg_options(payload.get("subtitle_style") or {})
                burn_subtitles(str(source), str(srt_path), str(output_path), **options)
                if not output_path.is_file():
                    raise RuntimeError("FFmpeg completed without producing a subtitle export.")
                _emit({"id": request_id, "type": "result", "result": {"outputUrl": f"/videos/{job_id}/{output_name}"}})
            finally:
                srt_path.unlink(missing_ok=True)
            return
        if operation == "face_tracking":
            from main import FACE_TRACKING_ALGORITHM_VERSION, analyze_face_tracking

            payload = request.get("payload") or {}
            source_path = str(payload.get("source_path") or "").strip()
            if not source_path:
                raise ValueError("face tracking source path is required")
            start_seconds = float(payload.get("start_seconds", 0))
            end_value = payload.get("end_seconds")
            end_seconds = None if end_value in (None, "") else float(end_value)
            if start_seconds < 0 or (end_seconds is not None and end_seconds <= start_seconds):
                raise ValueError("face tracking range must be increasing")
            result = analyze_face_tracking(
                source_path,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                source_width=payload.get("source_width"),
                source_height=payload.get("source_height"),
            )
            source = Path(source_path).resolve()
            stat = source.stat()
            result["algorithm_version"] = FACE_TRACKING_ALGORITHM_VERSION
            result["source_fingerprint"] = f"{source}:{stat.st_size}:{stat.st_mtime_ns}"
            _emit({"id": request_id, "type": "result", "result": result})
            return
        if operation == "legacy_api":
            _emit({"id": request_id, "type": "result", "result": _legacy_api(request)})
            return
        if operation not in {"clip_generation", "clip_render"}:
            raise ValueError(f"unsupported operation: {operation}")
        _emit({"id": request_id, "type": "started", "operation": operation})
        exit_code, result = _run_clip_generation(request)
        if exit_code != 0:
            _emit({"id": request_id, "type": "error", "error": f"worker exited with status {exit_code}"})
            return
        _emit({"id": request_id, "type": "result", "result": result or {}})
    except Exception as exc:  # the protocol must always return a terminal event
        _emit({"id": request_id, "type": "error", "error": str(exc)})


def main() -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = parse_request(line)
        except ValueError as exc:
            _emit({"type": "error", "error": str(exc)})
            continue
        handle_request(request)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
