from local_editor_subtitles import (
    build_local_editor_srt,
    subtitle_style_to_ffmpeg_options,
    word_captions_from_transcript,
)


def test_build_local_editor_srt_preserves_multiline_cue_text_and_timing():
    assert build_local_editor_srt([
        {"text": "Do I need\nto undress?", "startMs": 340, "endMs": 1720},
    ]) == (
        "1\n"
        "00:00:00,340 --> 00:00:01,720\n"
        "Do I need\n"
        "to undress?\n\n"
    )


def test_subtitle_style_maps_editor_values_to_existing_ffmpeg_renderer():
    assert subtitle_style_to_ffmpeg_options({
        "position": "middle",
        "fontFamily": "Verdana",
        "fontSize": 24,
        "fontColor": "#FFFF00",
        "borderColor": "#111111",
        "borderWidth": 3,
        "bgColor": "#000000",
        "bgOpacity": 0.5,
    }) == {
        "alignment": "middle",
        "fontsize": 24,
        "font_name": "Verdana",
        "font_color": "#FFFF00",
        "border_color": "#111111",
        "border_width": 3,
        "bg_color": "#000000",
        "bg_opacity": 0.5,
    }


def test_word_captions_from_transcript_matches_clip_generator_timing_contract():
    assert word_captions_from_transcript({
        "segments": [{
            "words": [
                {"word": "Do", "start": 0.2, "end": 0.4},
                {"word": "I", "start": 0.4, "end": 0.55},
            ],
        }],
    }) == [
        {"text": "Do", "startMs": 200, "endMs": 400},
        {"text": "I", "startMs": 400, "endMs": 550},
    ]
