"""JSON-lines worker bridge for media and AI workloads.

The Go control plane owns HTTP. This process accepts one or more newline-delimited
job requests on stdin and emits newline-delimited lifecycle events on stdout.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
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
    if name != "source_object":
        command.append("--keep-original")
    command.extend(["-o", str(request.get("output_dir") or "")])
    return command


def load_generation_result(output_dir: str) -> dict[str, Any]:
    metadata_files = sorted(Path(output_dir).glob("*_metadata.json"))
    if not metadata_files:
        raise FileNotFoundError("No metadata file generated")
    with metadata_files[0].open("r", encoding="utf-8") as source:
        data = json.load(source)
    return {
        "clips": data.get("shorts", []),
        "cost_analysis": data.get("cost_analysis"),
    }


def _emit(event: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(dict(event), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _run_clip_generation(request: Mapping[str, Any]) -> tuple[int, dict[str, Any] | None]:
    command = build_clip_generation_command(request)
    environment = os.environ.copy()
    for key, value in (request.get("environment") or {}).items():
        if value is not None:
            environment[str(key)] = str(value)

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
    return exit_code, load_generation_result(str(request.get("output_dir") or ""))


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
            transcript = transcribe_audio(source_path)
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

            _emit({"id": request_id, "type": "result", "result": default_codex_store().status()})
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
        if operation != "clip_generation":
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
