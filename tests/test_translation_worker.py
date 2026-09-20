import json

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


def test_perform_translation_batches_and_retries_incomplete_responses(monkeypatch):
    calls = []

    def fake_chat_json(_config, prompt, **_kwargs):
        batch = json.loads(prompt.split("Cues: ", 1)[1])
        calls.append(len(batch))
        if len(calls) == 1:
            return {"translations": ["only one result"]}
        return {"translations": [f"translated-{index}" for index in range(len(batch))]}

    monkeypatch.setattr("translation_worker.chat_json", fake_chat_json)

    source_cues = [
        {
            "text": f"cue-{index}",
            "startMs": index * 1000,
            "endMs": (index + 1) * 1000,
        }
        for index in range(23)
    ]
    track = perform_translation(
        {
            "target_language": "es",
            "source_track_id": "original",
            "tracks": [
                {"id": "original", "language": "en", "cues": source_cues}
            ],
        },
        {"X-AI-Provider": "lmstudio"},
    )

    assert calls == [20, 20, 3]
    assert len(track["cues"]) == len(source_cues)
    assert track["cues"][0]["text"] == "translated-0"
    assert track["cues"][-1]["text"] == "translated-2"
