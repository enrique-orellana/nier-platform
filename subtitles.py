import os
import re
import subprocess
from collections.abc import Mapping
from master_policy import master_video_encode_args, master_video_filter


SENTENCE_END_RE = re.compile(r"[.!?…]+(?:[\"'’”»)\]]+)?$")


def transcribe_audio(
    video_path,
    headers: Mapping[str, object] | None = None,
    start_seconds: float = 0.0,
    end_seconds: float | None = None,
):
    """Transcribe audio through OpenRouter; local Whisper is not available at runtime."""
    from ai_client import load_ai_config
    from highlight_generation import transcribe_video_with_config
    from media_probe import probe_media

    config = load_ai_config(headers)
    if config.transcription_provider != "openrouter":
        raise RuntimeError(
            "Local Whisper transcription is disabled. Configure OpenRouter transcription and retry."
        )
    duration_seconds = probe_media(video_path).duration_seconds
    if start_seconds == 0.0 and end_seconds is None:
        return transcribe_video_with_config(video_path, duration_seconds, headers=headers)
    return transcribe_video_with_config(
        video_path,
        duration_seconds,
        headers=headers,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
    )


def generate_srt_from_video(video_path, output_path, max_chars=20, max_duration=2.0, headers=None):
    """
    Transcribe a video and generate SRT directly.
    Used for dubbed videos that don't have a pre-existing transcript.
    """
    transcript = transcribe_audio(video_path, headers=headers)

    # Get video duration to use as clip_end
    import cv2
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps else 0
    cap.release()

    return generate_srt(transcript, 0, duration, output_path, max_chars, max_duration)


def build_subtitle_segments(transcript, clip_start, clip_end, max_chars=20, max_duration=2.0):
    """Build compact timed subtitle cues using the clip generator's rules."""
    words = []
    for segment in transcript.get('segments', []):
        segment_words = segment.get('words', []) or []
        if segment_words:
            for word_info in segment_words:
                word_start = float(word_info.get('start', 0.0))
                word_end = float(word_info.get('end', word_start))
                if word_end <= clip_start or word_start >= clip_end:
                    continue
                words.append({
                    'word': str(word_info.get('word', '')).strip(),
                    'start': word_start,
                    'end': word_end,
                })
            continue

        # Some providers return reliable segment timestamps but no word-level
        # timestamps. Keep those subtitles usable later by distributing the
        # segment duration across its words; the segment timing remains the
        # source of truth for the generated captions.
        segment_start = float(segment.get('start', 0.0))
        segment_end = float(segment.get('end', segment_start))
        segment_text = " ".join(str(segment.get('text', '') or '').split())
        fallback_words = segment_text.split()
        if not fallback_words or segment_end <= clip_start or segment_start >= clip_end:
            continue
        segment_duration = max(0.0, segment_end - segment_start)
        for index, word in enumerate(fallback_words):
            words.append({
                'word': word,
                'start': segment_start + segment_duration * index / len(fallback_words),
                'end': segment_start + segment_duration * (index + 1) / len(fallback_words),
            })

    words.sort(key=lambda word: (word['start'], word['end']))

    cues = []
    current_block = []
    block_start = None

    def append_current_block():
        if not current_block:
            return
        cues.append({
            'start': current_block[0]['start'],
            'end': current_block[-1]['end'],
            'text': " ".join(word['word'] for word in current_block).strip(),
        })

    for word in words:
        start = max(0, word['start'] - clip_start)
        end = max(0, word['end'] - clip_start)
        if not word['word'] or end <= start:
            continue

        normalized_word = {**word, 'start': start, 'end': end}
        if not current_block:
            current_block.append(normalized_word)
            block_start = start
        else:
            if SENTENCE_END_RE.search(current_block[-1]['word']):
                append_current_block()
                current_block = [normalized_word]
                block_start = start
                continue
            current_text_len = sum(len(w['word']) + 1 for w in current_block)
            duration = end - block_start
            if current_text_len + len(word['word']) > max_chars or duration > max_duration:
                append_current_block()
                current_block = [normalized_word]
                block_start = start
            else:
                current_block.append(normalized_word)

    append_current_block()
    return cues


def generate_srt(transcript, clip_start, clip_end, output_path, max_chars=20, max_duration=2.0):
    """Generate an SRT using compact timed cues for a specific time range."""
    cues = build_subtitle_segments(transcript, clip_start, clip_end, max_chars, max_duration)
    if not cues:
        return False

    srt_content = ""
    for index, cue in enumerate(cues, start=1):
        srt_content += format_srt_block(index, cue['start'], cue['end'], cue['text'])

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(srt_content)

    return True

def format_srt_block(index, start, end, text):
    def format_time(seconds):
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
        
    return f"{index}\n{format_time(start)} --> {format_time(end)}\n{text}\n\n"

def hex_to_ass_color(hex_color, opacity=1.0):
    """Convert #RRGGBB to ASS &HAABBGGRR format. opacity: 0.0=transparent, 1.0=opaque"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        hex_color = "FFFFFF"
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    alpha = round((1.0 - opacity) * 255)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def burn_subtitles(video_path, srt_path, output_path, alignment=2, fontsize=16,
                   font_name="Verdana", font_color="#FFFFFF",
                   border_color="#000000", border_width=2,
                   bg_color="#000000", bg_opacity=0.0):
    """
    Burns subtitles into the video using FFmpeg.
    Supports two modes:
    - Outline mode (bg_opacity=0): Text with colored outline/border
    - Box mode (bg_opacity>0): Text with semi-transparent background box
    """
    # Position mapping
    ass_alignment = 2
    align_lower = str(alignment).lower()
    if align_lower == 'top':
        ass_alignment = 6
    elif align_lower == 'middle':
        ass_alignment = 10
    elif align_lower == 'bottom':
        ass_alignment = 2

    # Font size scaling for ASS virtual resolution (PlayResY=288 default)
    # For vertical 1080x1920 video, we need larger text for readability
    final_fontsize = int(fontsize * 0.85)
    if final_fontsize < 10:
        final_fontsize = 10

    # Path handling for FFmpeg filter syntax
    safe_srt_path = srt_path.replace('\\', '/').replace(':', '\\:')

    # Convert colors to ASS format and build style
    primary_colour = hex_to_ass_color(font_color, 1.0)

    if bg_opacity > 0:
        # Box mode: opaque background box
        border_style = 3
        outline_colour = hex_to_ass_color(bg_color, bg_opacity)
        outline_width = 1
    else:
        # Outline mode: text border/outline
        border_style = 1
        outline_colour = hex_to_ass_color(border_color, 1.0)
        outline_width = max(1, border_width)

    back_colour = hex_to_ass_color("#000000", 0.0)

    style_string = (
        f"Alignment={ass_alignment},"
        f"Fontname={font_name},"
        f"Fontsize={final_fontsize},"
        f"PrimaryColour={primary_colour},"
        f"OutlineColour={outline_colour},"
        f"BackColour={back_colour},"
        f"BorderStyle={border_style},"
        f"Outline={outline_width},"
        f"Shadow=0,"
        f"MarginV=25,"
        f"Bold=1"
    )

    cmd = [
        'ffmpeg', '-y',
        '-i', video_path,
        '-vf', master_video_filter(f"subtitles='{safe_srt_path}':force_style='{style_string}'"),
        *master_video_encode_args(include_audio=True),
        output_path
    ]

    print(f"🎬 Burning subtitles: {' '.join(cmd)}")
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    if result.returncode != 0:
        print(f"❌ FFmpeg Subtitle Error: {result.stderr.decode()}")
        raise Exception(f"FFmpeg failed: {result.stderr.decode()}")

    return True

