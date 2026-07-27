import asyncio

import translation_service


def translation_request():
    return translation_service.TranslationRequest(
        target_language="es",
        source_track_id="original",
        tracks=[
            {
                "id": "original",
                "language": "en",
                "label": "Original",
                "cues": [
                    {"text": "Hello", "startMs": 0, "endMs": 500},
                    {"text": "world", "startMs": 500, "endMs": 1000},
                ],
            }
        ],
    )


def test_perform_translation_builds_a_translated_track(monkeypatch):
    monkeypatch.setattr(
        translation_service,
        "chat_json",
        lambda *args, **kwargs: {"translations": ["Hola", "mundo"]},
    )

    track = translation_service.perform_translation(
        translation_request(), {"X-AI-Provider": "lmstudio"}
    )

    assert track["id"] == "es"
    assert track["label"] == "ES"
    assert [cue["text"] for cue in track["cues"]] == ["Hola", "mundo"]


def test_run_translation_updates_job_status(monkeypatch):
    monkeypatch.setattr(
        translation_service,
        "chat_json",
        lambda *args, **kwargs: {"translations": ["Hola", "mundo"]},
    )
    translation_service.translation_jobs.clear()
    translation_service.translation_jobs["translation-1"] = {"status": "queued"}

    asyncio.run(
        translation_service.run_translation(
            "translation-1",
            translation_request(),
            {"X-AI-Provider": "lmstudio"},
        )
    )

    job = translation_service.translation_jobs["translation-1"]
    assert job["status"] == "done"
    assert job["track"]["language"] == "es"
