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
    for key in ("source_path", "source_asset", "source_object", "video_title", "transcript"):
        if key in data:
            result[key] = data[key]
    return result


def upload_generation_artifacts(output_dir: str, job_id: str, excluded_paths=None, include_paths=None, clip_id=None) -> bool:
    """Publish generated media to the configured MinIO/S3 output bucket."""
    if not str(os.environ.get("AWS_S3_BUCKET") or "").strip():
        return False
    from s3_uploader import upload_job_artifacts

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


def build_clip_generation_environment(request: Mapping[str, Any]) -> dict[str, str]:
    """Translate per-job AI headers into the environment consumed by main.py."""
    from ai_client import ai_config_to_env, load_ai_config

    environment = os.environ.copy()
    headers = request.get("headers") or {}
    if headers:
        environment.update(ai_config_to_env(load_ai_config(headers)))
    for key, value in (request.get("environment") or {}).items():
        if value is not None:
            environment[str(key)] = str(value)
    return environment


def _emit(event: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(dict(event), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _run_clip_generation(request: Mapping[str, Any]) -> tuple[int, dict[str, Any] | None]:
    output_dir = str(request.get("output_dir") or "")
    artifact_job_id = str(request.get("parent_job_id") or request["id"])
    operation = str(request.get("operation") or "")
    source_path = str(request.get("source_path") or "").strip()
    excluded_paths = set()
    preserve_paths = []
    if operation == "clip_render" and source_path:
        output_root = Path(output_dir).resolve()
        candidate = Path(source_path).resolve()
        try:
            excluded_paths.add(candidate.relative_to(output_root).as_posix())
            preserve_paths.append(str(candidate))
        except ValueError:
            pass
    if operation == "clip_render":
        from s3_uploader import hydrate_job_artifacts

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
        _emit({"id": request["id"], "type": "log", "message": line.rstrip("\r\n")})
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
    uploaded = upload_generation_artifacts(
        output_dir,
        artifact_job_id,
        excluded_paths=excluded_paths or None,
        include_paths=include_paths,
        clip_id=clip_id,
    )
    if uploaded:
        cleanup_generation_scratch(
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


def _thumbnail_publish_state_path(root: Path, publish_id: str) -> Path:
    publish_id = str(publish_id or "").strip()
    if not publish_id or Path(publish_id).name != publish_id:
        raise ValueError("publish_id is required")
    return root / f".thumbnail_publish_{publish_id}.json"


def _write_thumbnail_publish_state(root: Path, publish_id: str, state: dict[str, Any]) -> None:
    _thumbnail_publish_state_path(root, publish_id).write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")


def _persist_clip_url(job_root: Path, metadata: dict[str, Any], clip_index: int, url: str) -> None:
    metadata.setdefault("shorts", [])[clip_index]["video_url"] = url
    metadata_files = sorted(job_root.glob("*_metadata.json"))
    if metadata_files:
        metadata_files[0].write_text(json.dumps(metadata, indent=4, ensure_ascii=False), encoding="utf-8")


def _legacy_api(request: Mapping[str, Any]) -> dict[str, Any]:
    payload = request.get("payload") or {}
    action = str(payload.get("action") or "")
    root = _output_root(request)

    if action == "minio_objects":
        from minio_sources import list_source_objects
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
        _persist_clip_url(job_root_path, metadata, clip_index, url)
        return {"success": True, "job_id": payload["job_id"], "clip_index": clip_index, "video_url": url}

    if action in {"subtitle", "hook", "translate"}:
        input_path, metadata, clip_index = _job_paths(payload, root)
        job_id = str(payload["job_id"])
        job_root = root / job_id
        if action == "subtitle":
            from subtitles import burn_subtitles, generate_srt, generate_srt_from_video
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
            from hooks import add_hook_to_video, hook_style_for_layout
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
            from translate import translate_video
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
        from editor import VideoEditor
        from ai_client import load_ai_config
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
        from ai_client import load_ai_config
        from editor import VideoEditor
        editor = VideoEditor(api_key_or_config=load_ai_config(request.get("headers") or {}))
        return {"effects": editor.get_effects_config(editor.upload_video(str(input_path)), 0, transcript=metadata.get("transcript"))}

    if action == "subtitle_track_translate":
        from translation_worker import perform_translation
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

    if action.startswith("thumbnail_"):
        from thumbnail import analyze_video_for_titles, generate_thumbnail, refine_titles
        state_path = root / ".thumbnail_sessions.json"
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else {}
        session_id = str(payload.get("session_id") or uuid.uuid4())
        session = state.setdefault(session_id, {"conversation": []})
        if action == "thumbnail_upload":
            video_path = str(payload.get("file_path") or "")
            if video_path:
                session["video_path"] = video_path
                try:
                    from main import transcribe_video
                    transcript = transcribe_video(video_path)
                    session.update({"transcript": transcript, "transcript_ready": True, "transcript_segments": transcript.get("segments", []), "language": transcript.get("language", "en")})
                except Exception as exc:
                    session["transcript_error"] = str(exc)
            state_path.write_text(json.dumps(state), encoding="utf-8")
            return {"session_id": session_id}
        if action == "thumbnail_analyze":
            video_path = str(payload.get("video_path") or "")
            result = analyze_video_for_titles(request.get("headers") or {}, video_path, session.get("transcript"))
            session.update({"context": result.get("transcript_summary", ""), "titles": result.get("titles", []), "language": result.get("language", "en"), "video_path": video_path, "transcript_segments": result.get("segments", []), "video_duration": result.get("video_duration", 0)})
            state_path.write_text(json.dumps(state), encoding="utf-8")
            return {"session_id": session_id, "titles": result.get("titles", []), "context": result.get("transcript_summary", ""), "language": result.get("language", "en"), "recommended": result.get("recommended", [])}
        if action == "thumbnail_titles":
            if payload.get("title"):
                session["titles"] = [payload["title"]]
            else:
                session["conversation"].append({"role": "user", "content": payload.get("message", "")})
                result = refine_titles(request.get("headers") or {}, session.get("context", ""), payload.get("message", ""), session["conversation"])
                session["titles"] = result.get("titles", [])
            state_path.write_text(json.dumps(state), encoding="utf-8")
            return {"session_id": session_id, "titles": session.get("titles", [])}
        if action == "thumbnail_generate":
            count = min(max(1, int(payload.get("count") or 3)), 6)
            thumbnails = generate_thumbnail(request.get("headers") or {}, payload.get("title", ""), session_id, payload.get("face_path"), payload.get("background_path"), payload.get("extra_prompt", ""), count, session.get("context", ""))
            session["generated_thumbnails"] = thumbnails
            state_path.write_text(json.dumps(state), encoding="utf-8")
            return {"thumbnails": thumbnails}

    if action.startswith("thumbnail_project") or action in {"thumbnail_projects", "thumbnail_describe", "thumbnail_publish", "thumbnail_publish_status"}:
        from s3_uploader import (delete_thumbnail_project, delete_thumbnail_project_file, get_thumbnail_project,
                                 list_thumbnail_projects, migrate_legacy_thumbnail_projects,
                                 update_thumbnail_project, update_thumbnail_project_file, upload_thumbnail_project)
        if action == "thumbnail_projects":
            return {"projects": list_thumbnail_projects(limit=int(payload.get("limit") or 24)), "total": len(list_thumbnail_projects(limit=int(payload.get("limit") or 24)))}
        if action == "thumbnail_project_save":
            session_path = root / ".thumbnail_sessions.json"
            state = json.loads(session_path.read_text(encoding="utf-8")) if session_path.is_file() else {}
            session = state.get(str(payload.get("session_id") or ""))
            if session is None:
                raise FileNotFoundError("Session not found")
            return upload_thumbnail_project(str(payload["session_id"]), session, title=payload.get("title"), description=payload.get("description"), thumbnail_urls=payload.get("thumbnail_urls") or [], selected_thumbnail=payload.get("selected_thumbnail"))
        if action == "thumbnail_project_update":
            return update_thumbnail_project(str(payload["session_id"]), str(payload["project_slug"]), title=payload.get("title"), description=payload.get("description"), selected_thumbnail=payload.get("selected_thumbnail"))
        if action == "thumbnail_project_file_update":
            return update_thumbnail_project_file(str(payload["session_id"]), str(payload["project_slug"]), str(payload["file_path"]), str(payload.get("content") or ""))
        if action == "thumbnail_project_file_delete":
            return delete_thumbnail_project_file(str(payload["session_id"]), str(payload["project_slug"]), str(payload["file_path"]))
        if action == "thumbnail_project_delete":
            return delete_thumbnail_project(str(payload["session_id"]), str(payload["project_slug"]))
        if action == "thumbnail_projects_migrate_legacy":
            return migrate_legacy_thumbnail_projects(bool(payload.get("dry_run", False)), bool(payload.get("delete_source", True)))
        if action == "thumbnail_describe":
            from thumbnail import generate_youtube_description
            session_path = root / ".thumbnail_sessions.json"
            state = json.loads(session_path.read_text(encoding="utf-8")) if session_path.is_file() else {}
            session = state.get(str(payload.get("session_id") or ""))
            if not session or not session.get("transcript_segments"):
                raise ValueError("No transcript segments available. Please analyze a video first.")
            result = generate_youtube_description(request.get("headers") or {}, str(payload.get("title") or ""), session["transcript_segments"], session.get("language", "en"), session.get("video_duration", 0))
            session["description"] = result.get("description", "")
            session_path.write_text(json.dumps(state), encoding="utf-8")
            return result
        if action == "thumbnail_publish":
            session_id = str(payload.get("session_id") or "")
            session = state.get(session_id)
            video_path = Path(str((session or {}).get("video_path") or ""))
            if not session or not video_path.is_file():
                raise FileNotFoundError("Original video file not found")
            thumbnail_url = str(payload.get("thumbnail_url") or "").strip()
            relative_thumbnail = thumbnail_url.lstrip("/")
            thumbnail_path = root / relative_thumbnail if relative_thumbnail.startswith("thumbnails/") else root / "thumbnails" / relative_thumbnail
            try:
                thumbnail_path = thumbnail_path.resolve()
                if root.resolve() not in thumbnail_path.parents:
                    raise ValueError("Invalid thumbnail path")
            except OSError as exc:
                raise ValueError("Invalid thumbnail path") from exc
            if not thumbnail_path.is_file():
                raise FileNotFoundError("Thumbnail file not found")
            publish_id = str(payload.get("publish_id") or uuid.uuid4())
            uploading = {"publish_id": publish_id, "status": "uploading", "result": None, "error": None}
            _write_thumbnail_publish_state(root, publish_id, uploading)
            try:
                import httpx
                title = str(payload.get("title") or "Untitled")
                description = str(payload.get("description") or "")
                api_key = str(payload.get("api_key") or "")
                user_id = str(payload.get("user_id") or "")
                if not api_key or not user_id:
                    raise ValueError("api_key and user_id are required")
                data = {"user": user_id, "platform[]": "youtube", "title": title, "async_upload": "true", "youtube_title": title, "youtube_description": description, "privacyStatus": "public"}
                with video_path.open("rb") as video, thumbnail_path.open("rb") as thumbnail:
                    files = {"video": (video_path.name, video.read(), "video/mp4"), "thumbnail": (thumbnail_path.name, thumbnail.read(), "image/jpeg")}
                with httpx.Client(timeout=600.0) as client:
                    response = client.post("https://api.upload-post.com/api/upload", headers={"Authorization": f"Apikey {api_key}"}, data=data, files=files)
                if response.status_code not in {200, 201, 202}:
                    raise RuntimeError(f"Upload-Post API Error ({response.status_code}): {response.text}")
                completed = {"publish_id": publish_id, "status": "done", "result": response.json(), "error": None}
                _write_thumbnail_publish_state(root, publish_id, completed)
                return completed
            except Exception as exc:
                failed = {"publish_id": publish_id, "status": "failed", "result": None, "error": str(exc)}
                _write_thumbnail_publish_state(root, publish_id, failed)
                return failed
        if action == "thumbnail_publish_status":
            state_path = _thumbnail_publish_state_path(root, str(payload.get("publish_id") or ""))
            if not state_path.is_file():
                raise FileNotFoundError("Publish job not found")
            return json.loads(state_path.read_text(encoding="utf-8"))

    if action.startswith("saas_"):
        headers = request.get("headers") or {}
        from ai_client import load_ai_config
        from saasshorts import (DEFAULT_VOICES, analyze_saas, generate_actor_images, generate_full_video, generate_scripts,
                                get_elevenlabs_voices, research_saas_online, scrape_website)
        if action == "saas_analyze":
            url = str(payload.get("url") or "").strip()
            description = str(payload.get("description") or "").strip()
            if not url and not description:
                raise ValueError("Provide a URL or a product description")
            ai_config = load_ai_config(headers)
            if url:
                scraped = scrape_website(url)
                research = research_saas_online(url, ai_config, scraped_data=scraped)
                analysis = analyze_saas(scraped, ai_config, web_research=research)
            else:
                research = None
                analysis = {"product_name": description.split(",")[0][:60], "description": description, "value_proposition": description, "target_audience": "general audience", "key_features": [description], "pain_points": [], "tone": "casual and authentic"}
            scripts = generate_scripts(analysis, ai_config, int(payload.get("num_scripts") or 3), str(payload.get("style") or "ugc"), str(payload.get("language") or "en"), str(payload.get("actor_gender") or "female"))
            return {"analysis": analysis, "scripts": scripts, "web_research": research}
        if action == "saas_actor_upload":
            source = Path(str(payload.get("file_path") or ""))
            if not source.is_file(): raise FileNotFoundError("Actor image not found")
            directory = root / "actor_uploads"; directory.mkdir(parents=True, exist_ok=True)
            name = f"custom_{uuid.uuid4().hex[:8]}.png"; target = directory / name
            target.write_bytes(source.read_bytes())
            return {"url": f"/videos/actor_uploads/{name}"}
        if action == "saas_actor_options":
            key = str(headers.get("X-Fal-Key") or "")
            if not key: raise ValueError("Missing fal.ai API Key")
            actor_dir = root / f"saas_actors_{uuid.uuid4().hex}"; actor_dir.mkdir(parents=True, exist_ok=True)
            paths = generate_actor_images(str(payload.get("actor_description") or ""), key, str(actor_dir), "actor", int(payload.get("num_options") or 3), product_description=payload.get("product_description"))
            return {"images": [f"/videos/{p.relative_to(root).as_posix()}" for p in paths]}
        if action == "saas_gallery":
            from s3_uploader import list_video_gallery
            videos = list_video_gallery(int(payload.get("limit") or 50))
            return {"videos": videos, "total": len(videos)}
        if action == "saas_actor_gallery":
            from s3_uploader import list_actor_gallery
            return {"images": list_actor_gallery()}
        if action == "saas_voices":
            key = str(headers.get("X-ElevenLabs-Key") or "")
            voices = get_elevenlabs_voices(key) if key else []
            return {"voices": voices or [{"voice_id": voice_id, "name": name, "category": "default"} for name, voice_id in DEFAULT_VOICES.items()], "source": "elevenlabs" if voices else "defaults"}
        if action == "saas_generate":
            fal_key = str(headers.get("X-Fal-Key") or ""); eleven_key = str(headers.get("X-ElevenLabs-Key") or "")
            if not fal_key or not eleven_key: raise ValueError("Missing fal.ai or ElevenLabs API Key")
            job_id = str(payload.get("retry_job_id") or uuid.uuid4())
            job_dir = root / f"saas_{job_id}"; job_dir.mkdir(parents=True, exist_ok=True)
            config = {"fal_key": fal_key, "elevenlabs_key": eleven_key, "voice_id": payload.get("voice_id") or "21m00Tcm4TlvDq8ikWAM", "actor_description": payload.get("actor_description"), "video_mode": payload.get("video_mode") or "lowcost", "headers": headers}
            result = generate_full_video(payload.get("script") or {}, config, str(job_dir), lambda _: None)
            response = {"job_id": job_id, "status": "completed", "result": {"video_url": f"/videos/saas_{job_id}/{result['video_filename']}", "video_filename": result["video_filename"], "duration": result.get("duration", 0), "cost_estimate": result.get("cost_estimate", {}), "script": payload.get("script") or {}}}
            (root / f".saas_{job_id}.json").write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
            return response
        if action == "saas_status":
            path = root / f".saas_{payload.get('job_id')}.json"
            if not path.is_file():
                raise FileNotFoundError("SaaSShorts job not found")
            return json.loads(path.read_text(encoding="utf-8"))
        if action == "saas_post":
            record_path = root / f".saas_{payload.get('job_id')}.json"
            if not record_path.is_file(): raise FileNotFoundError("SaaSShorts job not found")
            record = json.loads(record_path.read_text(encoding="utf-8"))
            video_url = str(record.get("result", {}).get("video_url") or "")
            video_path = root / video_url.removeprefix("/videos/")
            if not video_path.is_file(): raise FileNotFoundError("SaaSShorts video not found")
            import httpx
            platforms = payload.get("platforms") or []
            title = payload.get("title") or record.get("result", {}).get("script", {}).get("title", "Viral Short")
            description = payload.get("description") or record.get("result", {}).get("script", {}).get("caption", "Check this out!")
            data = {"user": payload.get("user_id"), "title": title, "platform[]": platforms, "async_upload": "true"}
            if "youtube" in platforms: data.update({"youtube_title": title, "youtube_description": description, "privacyStatus": "public"})
            with video_path.open("rb") as video:
                response = httpx.post("https://api.upload-post.com/api/upload", headers={"Authorization": f"Apikey {payload.get('api_key')}"}, data=data, files={"video": (video_path.name, video, "video/mp4")}, timeout=120)
            if response.status_code not in {200, 201, 202}: raise RuntimeError(f"Vendor API Error: {response.text}")
            return response.json()

    if action == "saas_voices":
        from saasshorts import DEFAULT_VOICES, get_elevenlabs_voices
        key = str(request.get("headers", {}).get("X-ElevenLabs-Key") or "")
        voices = get_elevenlabs_voices(key) if key else []
        if voices:
            return {"voices": voices, "source": "elevenlabs"}
        return {"voices": [{"voice_id": voice_id, "name": name, "category": "default"} for name, voice_id in DEFAULT_VOICES.items()], "source": "defaults"}

    raise ValueError(f"unsupported legacy action: {action}")


def handle_request(request: Mapping[str, Any]) -> None:
    request_id = str(request["id"])
    operation = str(request["operation"])
    try:
        if operation == "translation":
            from translation_worker import perform_translation

            track = perform_translation(request.get("payload") or {}, request.get("headers") or {})
            _emit({"id": request_id, "type": "result", "result": {"track": track}})
            return
        if operation == "transcribe":
            from local_editor_subtitles import word_captions_from_transcript
            from subtitles import build_subtitle_segments, transcribe_audio

            source_path = str((request.get("payload") or {}).get("source_path") or "").strip()
            if not source_path:
                raise ValueError("transcription source path is required")
            transcript = transcribe_audio(
                source_path,
                headers=request.get("headers") if isinstance(request.get("headers"), Mapping) else None,
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
            from codex_auth import default_codex_store

            pending_path = Path(str(request.get("output_dir") or "output")) / ".codex-pending.json"
            status = default_codex_store().status()
            status["pending"] = pending_path.is_file()
            _emit({"id": request_id, "type": "result", "result": status})
            return
        if operation == "codex_disconnect":
            from codex_auth import default_codex_store

            default_codex_store().clear()
            _emit({"id": request_id, "type": "result", "result": {"connected": False, "pending": False}})
            return
        if operation == "codex_models":
            from ai_client import discover_codex_models

            discovered = discover_codex_models()
            _emit({"id": request_id, "type": "result", "result": {
                "provider": "openai-codex",
                "models": discovered.get("models", []),
                "defaultModel": discovered.get("defaultModel", ""),
            }})
            return
        if operation == "codex_connect":
            from codex_auth import start_device_login

            root = _output_root(request)
            pending = start_device_login().pending
            (root / ".codex-pending.json").write_text(json.dumps({"device_auth_id": pending.device_auth_id, "user_code": pending.user_code, "interval_seconds": pending.interval_seconds, "started_at": pending.started_at}), encoding="utf-8")
            _emit({"id": request_id, "type": "result", "result": {"status": "pending", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": pending.user_code, "intervalSeconds": pending.interval_seconds}})
            return
        if operation == "codex_poll":
            from codex_auth import PendingDeviceLogin, default_codex_store, poll_device_login_once

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
        if operation == "hashtags":
            from ai_client import chat_json, load_ai_config

            payload = request.get("payload") or {}
            headers = request.get("headers") or {}
            config = load_ai_config(headers)
            if config.is_gemini() and not config.api_key:
                raise ValueError("Missing X-Gemini-Key header")
            prompt = (
                "Generate 8 to 12 relevant social-media hashtags. Return JSON only with "
                '{"hashtags":["#tag1"]}. Use the source language and do not return duplicates.\n\n'
                f"TITLE: {str(payload.get('title') or '').strip()}\n"
                f"CAPTION: {str(payload.get('caption') or '').strip()}\n"
                f"SUBTITLES: {str(payload.get('subtitle_text') or '').strip()}\n"
                f"SOURCE CONTEXT: {json.dumps(payload.get('source_context') or {}, ensure_ascii=False)}"
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
        if operation == "burn_subtitles":
            import uuid

            from local_editor_subtitles import subtitle_style_to_ffmpeg_options, write_local_editor_srt
            from subtitles import burn_subtitles

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
        if operation == "legacy_api":
            _emit({"id": request_id, "type": "result", "result": _legacy_api(request)})
            return
        if operation == "highlight_generation":
            from highlight_generation import run_highlight_generation

            _emit({"id": request_id, "type": "started", "operation": operation})
            result = run_highlight_generation(request, lambda message: _emit({"id": request_id, "type": "log", "message": message}))
            _emit({"id": request_id, "type": "result", "result": result})
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
