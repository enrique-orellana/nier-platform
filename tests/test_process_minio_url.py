import main


def test_legacy_ytdlp_helper_remains_available():
    assert callable(main.download_youtube_video)
