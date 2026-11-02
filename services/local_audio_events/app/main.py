"""Versioned HTTP API for local audio-event detection."""

from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .audio import AudioDecodeError, decode_audio
from .detector import AudioEventDetector, create_detector


def _required_setting(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} must be configured")
    return value


def _max_upload_bytes() -> int:
    try:
        value = int(_required_setting("AUDIO_EVENT_MAX_UPLOAD_BYTES"))
    except ValueError as exc:
        raise ValueError(
            "AUDIO_EVENT_MAX_UPLOAD_BYTES must be a positive integer"
        ) from exc
    if value <= 0:
        raise ValueError("AUDIO_EVENT_MAX_UPLOAD_BYTES must be a positive integer")
    return value


def create_app(
    detector_factory: Callable[[str], AudioEventDetector] = create_detector,
) -> FastAPI:
    """Build the service with an injectable detector factory for testability."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        detector_id = _required_setting("AUDIO_EVENT_DETECTOR")
        app.state.detector_id = detector_id
        app.state.model_id = _required_setting("AUDIO_EVENT_MODEL")
        if app.state.model_id != detector_id:
            raise ValueError("AUDIO_EVENT_MODEL must match AUDIO_EVENT_DETECTOR")
        app.state.max_upload_bytes = _max_upload_bytes()
        app.state.detector = detector_factory(detector_id)
        app.state.inference_lock = threading.Lock()
        yield

    app = FastAPI(
        title="OpenShorts Local Audio Events",
        version="1.0.0",
        lifespan=lifespan,
    )

    @app.get("/health")
    def health() -> dict[str, Any]:
        detector = getattr(app.state, "detector", None)
        return {
            "ok": detector is not None,
            "provider": getattr(app.state, "detector_id", "unavailable"),
            "model": getattr(app.state, "model_id", "unavailable"),
        }

    @app.post("/v1/audio/events")
    async def detect_audio_events(
        file: UploadFile = File(...),
        model: str = Form(...),
    ) -> dict[str, list[dict[str, Any]]]:
        if model != app.state.model_id:
            raise HTTPException(
                status_code=422,
                detail="Requested audio-event model is not configured",
            )

        payload = await file.read(app.state.max_upload_bytes + 1)
        if len(payload) > app.state.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail="Uploaded audio exceeds the configured size limit",
            )

        def run_detection() -> list[dict[str, Any]]:
            with app.state.inference_lock:
                waveform, duration = decode_audio(payload)
                return app.state.detector.detect(waveform, duration_seconds=duration)

        try:
            events = await run_in_threadpool(run_detection)
        except AudioDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail="Audio-event detection failed"
            ) from exc
        finally:
            await file.close()
        return {"events": events}

    return app


app = create_app()
