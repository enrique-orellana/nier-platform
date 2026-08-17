from subtitles import build_subtitle_segments


def test_build_subtitle_segments_matches_clip_generator_chunking_rules():
    transcript = {
        "segments": [{
            "words": [
                {"word": "Adesso", "start": 0.0, "end": 0.3},
                {"word": "ti", "start": 0.3, "end": 0.6},
                {"word": "faccio", "start": 0.6, "end": 0.9},
                {"word": "vedere", "start": 0.9, "end": 1.2},
            ],
        }],
    }

    cues = build_subtitle_segments(transcript, 0, 2, max_chars=16, max_duration=2.0)

    assert cues == [
        {"start": 0.0, "end": 0.9, "text": "Adesso ti faccio"},
        {"start": 0.9, "end": 1.2, "text": "vedere"},
    ]


def test_build_subtitle_segments_starts_a_new_cue_after_sentence_punctuation():
    transcript = {
        "segments": [{
            "words": [
                {"word": "sono", "start": 0.0, "end": 0.3},
                {"word": "un", "start": 0.3, "end": 0.5},
                {"word": "professionista.", "start": 0.5, "end": 1.0},
                {"word": "È", "start": 1.0, "end": 1.2},
                {"word": "importante", "start": 1.2, "end": 1.7},
            ],
        }],
    }

    cues = build_subtitle_segments(transcript, 0, 2, max_chars=80, max_duration=5.0)

    assert cues == [
        {"start": 0.0, "end": 1.0, "text": "sono un professionista."},
        {"start": 1.0, "end": 1.7, "text": "È importante"},
    ]


def test_build_subtitle_segments_uses_provider_segments_without_word_timestamps():
    transcript = {
        "language": "es",
        "segments": [{
            "start": 10.0,
            "end": 12.5,
            "text": "Hola, esto sigue funcionando.",
            "words": [],
        }],
    }

    cues = build_subtitle_segments(transcript, 10.0, 12.5, max_chars=80, max_duration=5.0)

    assert cues == [{
        "start": 0.0,
        "end": 2.5,
        "text": "Hola, esto sigue funcionando.",
    }]
