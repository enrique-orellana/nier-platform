from translation_worker import perform_translation


def test_perform_translation_is_framework_free(monkeypatch):
    monkeypatch.setattr(
        "translation_worker.chat_json",
        lambda *args, **kwargs: {"translations": ["Hola", "mundo"]},
    )

    track = perform_translation(
        {
            "target_language": "es",
            "source_track_id": "original",
            "tracks": [
                {
                    "id": "original",
                    "language": "en",
                    "cues": [
                        {"text": "Hello", "startMs": 0, "endMs": 500},
                        {"text": "world", "startMs": 500, "endMs": 1000},
                    ],
                }
            ],
        },
        {"X-AI-Provider": "lmstudio"},
    )

    assert track["id"] == "es"
    assert track["label"] == "ES"
    assert [cue["text"] for cue in track["cues"]] == ["Hola", "mundo"]
