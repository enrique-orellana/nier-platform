from subtitle_translation import map_translation_to_cues, translate_cue_texts


def cue(text, start, end):
    return {"text": text, "startMs": start, "endMs": end}


def test_translated_words_share_original_cue_interval():
    source = [cue("This is", 0, 1000)]
    result = map_translation_to_cues(source, ["Esto es"], language="es")

    assert [(word["startMs"], word["endMs"]) for word in result[0]["captions"]] == [
        (0, 500),
        (500, 1000),
    ]
    assert result[0]["language"] == "es"


def test_translation_does_not_mutate_original_cues():
    source = [cue("Hello", 100, 900)]
    translate_cue_texts(source, "en", "fr", lambda texts, *_: ["Bonjour"])
    assert source == [cue("Hello", 100, 900)]
