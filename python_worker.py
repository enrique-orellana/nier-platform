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


def _emit(event: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(dict(event), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _run_clip_generation(request: Mapping[str, Any]) -> int:
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
    return process.wait()


def handle_request(request: Mapping[str, Any]) -> None:
    request_id = str(request["id"])
    operation = str(request["operation"])
    try:
        if operation != "clip_generation":
            raise ValueError(f"unsupported operation: {operation}")
        _emit({"id": request_id, "type": "started", "operation": operation})
        exit_code = _run_clip_generation(request)
        if exit_code != 0:
            _emit({"id": request_id, "type": "error", "error": f"worker exited with status {exit_code}"})
            return
        _emit({"id": request_id, "type": "result", "result": {"output_dir": request.get("output_dir")}})
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
