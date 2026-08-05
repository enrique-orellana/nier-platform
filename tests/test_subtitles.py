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
