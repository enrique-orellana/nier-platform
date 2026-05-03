import os
import uuid
import time
import json
import re
import textwrap
from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from ai_client import AIConfig, load_ai_config, chat_json


def analyze_video_for_titles(api_key, video_path, transcript=None):
    """
    Transcribes a video and uses Gemini to suggest viral YouTube titles.
    If transcript is provided, skips Whisper transcription.
    Returns: { "titles": [...], "transcript_summary": "...", "language": "...", "segments": [...], "video_duration": ... }
    """
    if transcript is None:
        from main import transcribe_video
        print("🎬 [Thumbnail] Transcribing video...")
        transcript = transcribe_video(video_path)
    else:
        print("🎬 [Thumbnail] Using pre-computed transcript (Whisper already done)...")

    print("📤 [Thumbnail] Uploading video to Gemini...")
    client = genai.Client(api_key=api_key)

    file_upload = client.files.upload(file=video_path)
    while True:
        file_info = client.files.get(name=file_upload.name)
        if file_info.state == "ACTIVE":
            break
        elif file_info.state == "FAILED":
            raise Exception("Video processing failed by Gemini.")
        time.sleep(2)

    prompt = f"""You are a YouTube title expert who creates viral, click-worthy titles.

Analyze this video and its transcript, then suggest 10 YouTube titles that would maximize CTR (click-through rate).

TRANSCRIPT:
{transcript['text']}

RULES:
- Titles must be under 70 characters
- Use power words, curiosity gaps, and emotional triggers
- Mix styles: how-to, listicle, story-driven, controversial, question-based
- Make them specific to the actual content, not generic
- Include numbers where appropriate
- Consider the language of the video (detected: {transcript['language']})
- Titles should be in the SAME LANGUAGE as the video transcript

Also provide a brief summary of the video content (2-3 sentences).

After generating all 10 titles, pick the TOP 2 you most recommend and explain concisely WHY (CTR potential, emotional hook, uniqueness, etc.). Reference them by their 0-based index in the titles array.

OUTPUT JSON:
{{
    "titles": ["title1", "title2", ...],
    "transcript_summary": "Brief summary of the video content...",
    "language": "{transcript['language']}",
    "recommended": [
        {{"index": 0, "reason": "Why this title is best..."}},
        {{"index": 3, "reason": "Why this title is second best..."}}
    ]
}}"""

    print("🤖 [Thumbnail] Asking Gemini for title suggestions...")
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[file_upload, prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )

    # Extract segments and duration from transcript for later use
    segments = transcript.get("segments", [])
    video_duration = segments[-1]["end"] if segments else 0

    try:
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        start_idx = text.find('{')
        end_idx = text.rfind('}')
        if start_idx != -1 and end_idx != -1:
            text = text[start_idx:end_idx + 1]

        result = json.loads(text)
        result["transcript_summary"] = result.get("transcript_summary", "")
        result["language"] = result.get("language", transcript["language"])
        result["segments"] = segments
        result["video_duration"] = video_duration
        return result
    except json.JSONDecodeError:
        print(f"❌ [Thumbnail] Failed to parse titles JSON: {response.text}")
        return {
            "titles": ["Could not generate titles - please try again"],
            "transcript_summary": transcript["text"][:500],
            "language": transcript["language"],
            "segments": segments,
            "video_duration": video_duration
        }


def refine_titles(api_key, context, user_message, conversation_history=None):
    """
    Takes video context + user feedback and returns refined title suggestions.
    """
    client = genai.Client(api_key=api_key)

    history_text = ""
    if conversation_history:
        for msg in conversation_history:
            role = msg.get("role", "user")
            history_text += f"\n{role.upper()}: {msg['content']}"

    prompt = f"""You are a YouTube title expert. Based on the video context and the user's feedback, suggest 8 new refined YouTube titles.

VIDEO CONTEXT:
{context}

CONVERSATION HISTORY:{history_text}

USER'S NEW REQUEST:
{user_message}

RULES:
- Titles must be under 70 characters
- Incorporate the user's feedback/direction
- Keep titles viral and click-worthy
- If the user asks for a specific style, follow it
- Titles should be in the same language as the original content

OUTPUT JSON:
{{
    "titles": ["title1", "title2", ...]
}}"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )

    try:
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        start_idx = text.find('{')
        end_idx = text.rfind('}')
        if start_idx != -1 and end_idx != -1:
            text = text[start_idx:end_idx + 1]

        return json.loads(text)
    except json.JSONDecodeError:
        print(f"❌ [Thumbnail] Failed to parse refined titles: {response.text}")
        return {"titles": ["Could not refine titles - please try again"]}


def generate_thumbnail(api_key, title, session_id, face_image_path=None, bg_image_path=None, extra_prompt="", count=3, video_context=""):
    """
    Generates YouTube thumbnails using Gemini image generation.
    Returns list of saved image paths (relative URLs).
    """
    client = genai.Client(api_key=api_key)

    output_dir = os.path.join("output", "thumbnails", session_id)
    os.makedirs(output_dir, exist_ok=True)

    prompt_parts = []

    # Add face image if provided
    if face_image_path and os.path.exists(face_image_path):
        face_img = Image.open(face_image_path)
        prompt_parts.append(face_img)

    # Add background image if provided
    if bg_image_path and os.path.exists(bg_image_path):
        bg_img = Image.open(bg_image_path)
        prompt_parts.append(bg_img)

    # Build video context block
    context_block = ""
    if video_context:
        context_block = f"""
VIDEO CONTEXT (use this to understand the video and design a relevant thumbnail):
{video_context}
"""

    # Build extra instructions block (high priority)
    extra_block = ""
    if extra_prompt:
        extra_block = f"""
⚠️ MANDATORY USER INSTRUCTIONS (MUST follow these exactly — they override any default behavior):
{extra_prompt}
"""

    text_prompt = f"""Generate a professional, eye-catching YouTube thumbnail image.

VIDEO TITLE (for reference — do NOT put the full title on the thumbnail): "{title}"
{context_block}
TEXT ON THE THUMBNAIL:
- Based on the title AND the video context, create a SHORT visual hook: 1 to 5 words maximum
- It should capture the core emotion, surprise, or promise of the video
- The thumbnail text should COMPLEMENT the YouTube title (which appears below), not repeat it
- Examples: "$10K EN 30 DÍAS", "ESTO FUNCIONA", "NO LO SABÍAS", "GRATIS 🔥"
- Use ALL CAPS for maximum impact, split into 2-3 lines
{extra_block}
DESIGN REQUIREMENTS:
- The text MUST be large, bold, and high-contrast (readable at small sizes)
- Use vibrant, eye-catching colors that match the video's mood
- Professional YouTube thumbnail aesthetic
- Clean composition — text and face/subject as clear focal points
- NO clutter, NO small text, NO watermarks"""

    if face_image_path and os.path.exists(face_image_path):
        text_prompt += "\n- Include the provided face/person prominently with an exaggerated expression (surprise, excitement, shock)"

    if bg_image_path and os.path.exists(bg_image_path):
        text_prompt += "\n- Use the provided background image as the base/backdrop"

    prompt_parts.append(text_prompt)

    thumbnails = []
    last_error = None
    for i in range(count):
        print(f"🎨 [Thumbnail] Generating thumbnail {i + 1}/{count}...")
        try:
            response = client.models.generate_content(
                model="gemini-3.1-flash-image-preview",
                contents=prompt_parts,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    image_config=types.ImageConfig(
                        aspect_ratio="16:9",
                        image_size="2K"
                    )
                )
            )

            for part in response.parts:
                if part.text is not None:
                    print(f"📝 [Thumbnail] Gemini text: {part.text}")
                elif image := part.as_image():
                    filename = f"thumb_{i + 1}.jpg"
                    filepath = os.path.join(output_dir, filename)
                    image.save(filepath)
                    thumbnails.append(f"/thumbnails/{session_id}/{filename}")
                    print(f"✅ [Thumbnail] Saved: {filepath}")
                    break

        except Exception as e:
            last_error = str(e)
            print(f"❌ [Thumbnail] Generation {i + 1} failed: {e}")

    if not thumbnails and last_error:
        raise RuntimeError(f"All thumbnail generations failed. Last error: {last_error}")

    return thumbnails


def generate_youtube_description(api_key, title, transcript_segments, language, video_duration):
    """
    Uses Gemini to generate a YouTube description with chapter markers from transcript segments.
    Returns: { "description": "full description text with chapters" }
    """
    client = genai.Client(api_key=api_key)

    # Format segments for the prompt
    formatted_segments = []
    for seg in transcript_segments:
        start = seg.get("start", 0)
        mins = int(start // 60)
        secs = int(start % 60)
        timestamp = f"{mins}:{secs:02d}"
        formatted_segments.append(f"[{timestamp}] {seg.get('text', '').strip()}")

    segments_text = "\n".join(formatted_segments)

    # Format total duration
    dur_mins = int(video_duration // 60)
    dur_secs = int(video_duration % 60)
    duration_str = f"{dur_mins}:{dur_secs:02d}"

    prompt = f"""You are a YouTube SEO expert. Generate a complete YouTube video description for the following video.

VIDEO TITLE: "{title}"
VIDEO LANGUAGE: {language}
VIDEO DURATION: {duration_str}

TRANSCRIPT WITH TIMESTAMPS:
{segments_text}

REQUIREMENTS:
1. Write the description in the SAME LANGUAGE as the video ({language})
2. Start with a compelling 2-3 sentence summary/hook
3. Add relevant CTAs (subscribe, like, comment)
4. Generate YouTube CHAPTERS based on the transcript timestamps:
   - First chapter MUST start at 0:00
   - Minimum 3 chapters, each at least 10 seconds apart
   - Chapter titles should be concise and descriptive
   - Format: 0:00 Chapter Title
   - Place chapters in their own section with a blank line before and after
5. Add 5-10 relevant hashtags at the end
6. Keep the total description under 5000 characters

OUTPUT: Return ONLY the description text (no JSON wrapper, no markdown code blocks). The description should be ready to paste directly into YouTube."""

    print("🤖 [Thumbnail] Generating YouTube description with chapters...")
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[prompt],
    )

    description = response.text.strip()
    # Clean up any accidental markdown wrappers
    if description.startswith("```"):
        lines = description.split("\n")
        description = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    return {"description": description}


# ---------------------------------------------------------------------------
# Provider-aware overrides
# ---------------------------------------------------------------------------

def _resolve_ai_config(api_key_or_config):
    if isinstance(api_key_or_config, AIConfig):
        return api_key_or_config
    return load_ai_config({"X-AI-Api-Key": api_key_or_config or ""})


def _thumbnail_palette(seed_text: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    palettes = [
        ((255, 95, 31), (24, 24, 27)),
        ((14, 165, 233), (15, 23, 42)),
        ((236, 72, 153), (26, 11, 63)),
        ((250, 204, 21), (20, 20, 20)),
        ((34, 197, 94), (5, 46, 22)),
    ]
    idx = abs(hash(seed_text)) % len(palettes)
    return palettes[idx]


def _cover_image(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    src = image.copy().convert("RGB")
    src.thumbnail((size[0], size[1]), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size)
    x = (size[0] - src.width) // 2
    y = (size[1] - src.height) // 2
    canvas.paste(src, (x, y))
    return canvas.filter(ImageFilter.GaussianBlur(2))


def _safe_hook_text(candidate: str, fallback: str) -> str:
    text = re.sub(r"\s+", " ", (candidate or "").strip())
    if not text:
        return fallback
    words = text.split()
    if len(words) > 5:
        text = " ".join(words[:5])
    return text.upper()


def _compose_local_thumbnail(
    title: str,
    session_id: str,
    face_image_path=None,
    bg_image_path=None,
    extra_prompt="",
    count=3,
    video_context="",
    headline_candidates=None,
):
    output_dir = os.path.join("output", "thumbnails", session_id)
    os.makedirs(output_dir, exist_ok=True)

    from hooks import download_font_if_needed

    download_font_if_needed()
    try:
        font = ImageFont.truetype("fonts/NotoSerif-Bold.ttf", 72)
    except Exception:
        font = ImageFont.load_default()

    candidates = headline_candidates or []
    base_hook = _safe_hook_text(candidates[0] if candidates else title, title)
    if extra_prompt:
        prompt_hook = _safe_hook_text(extra_prompt, base_hook)
        if prompt_hook:
            candidates = [prompt_hook, base_hook] + [c for c in candidates if c != prompt_hook]
    if video_context:
        context_hook = _safe_hook_text(video_context, base_hook)
        if context_hook and context_hook not in candidates:
            candidates.append(context_hook)
    if base_hook not in candidates:
        candidates.insert(0, base_hook)

    while len(candidates) < count:
        candidates.append(base_hook)

    saved = []
    size = (1280, 720)
    for i in range(count):
        bg_a, bg_b = _thumbnail_palette(f"{title}-{i}")
        canvas = Image.new("RGB", size, bg_b)
        draw = ImageDraw.Draw(canvas)

        for y in range(size[1]):
            blend = y / max(1, size[1] - 1)
            color = (
                int(bg_a[0] * (1 - blend) + bg_b[0] * blend),
                int(bg_a[1] * (1 - blend) + bg_b[1] * blend),
                int(bg_a[2] * (1 - blend) + bg_b[2] * blend),
            )
            draw.line((0, y, size[0], y), fill=color)

        if bg_image_path and os.path.exists(bg_image_path):
            try:
                bg_img = Image.open(bg_image_path)
                canvas = Image.blend(canvas, _cover_image(bg_img, size), 0.35)
                draw = ImageDraw.Draw(canvas)
            except Exception:
                pass

        overlay = Image.new("RGBA", size, (0, 0, 0, 70))
        canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(canvas)

        if face_image_path and os.path.exists(face_image_path):
            try:
                face = Image.open(face_image_path).convert("RGB")
                face.thumbnail((520, 520), Image.Resampling.LANCZOS)
                face_x = size[0] - face.width - 48
                face_y = size[1] - face.height - 36
                canvas.paste(face, (face_x, face_y))
            except Exception:
                pass

        hook_text = candidates[i % len(candidates)]
        text_box = (64, 96, 720, 560)
        draw.rounded_rectangle(text_box, radius=28, fill=(10, 10, 12))
        wrapped = textwrap.fill(hook_text, width=14)
        draw.multiline_text((96, 160), wrapped, font=font, fill="white", spacing=12, align="left")

        sub_font_size = 30
        try:
            sub_font = ImageFont.truetype("fonts/NotoSerif-Bold.ttf", sub_font_size)
        except Exception:
            sub_font = ImageFont.load_default()
        subtitle = _safe_hook_text(extra_prompt or video_context or title, title)
        draw.text((96, 470), subtitle[:48], font=sub_font, fill=(240, 240, 240))

        filename = f"thumb_{i + 1}.jpg"
        filepath = os.path.join(output_dir, filename)
        canvas.save(filepath, quality=92)
        saved.append(f"/thumbnails/{session_id}/{filename}")

    return saved


def analyze_video_for_titles(api_key_or_config, video_path, transcript=None):
    ai_config = _resolve_ai_config(api_key_or_config)
    if transcript is None:
        from main import transcribe_video
        transcript = transcribe_video(video_path)

    prompt = f"""You are a YouTube title expert who creates viral, click-worthy titles.

Analyze this video transcript and suggest 10 YouTube titles that would maximize CTR (click-through rate).

TRANSCRIPT:
{transcript['text']}

RULES:
- Titles must be under 70 characters
- Use power words, curiosity gaps, and emotional triggers
- Titles should be in the SAME LANGUAGE as the transcript

Return JSON:
{{
  "titles": ["title1", "title2"],
  "transcript_summary": "brief summary",
  "language": "{transcript['language']}",
  "recommended": [{{"index": 0, "reason": "why"}}]
}}"""

    result = chat_json(ai_config, prompt, model=ai_config.text_model)
    segments = transcript.get("segments", [])
    result["segments"] = segments
    result["video_duration"] = segments[-1]["end"] if segments else 0
    result["language"] = result.get("language", transcript.get("language", "en"))
    result["transcript_summary"] = result.get("transcript_summary", transcript.get("text", "")[:500])
    if "titles" not in result:
        result["titles"] = ["Could not generate titles - please try again"]
    return result


def refine_titles(api_key_or_config, context, user_message, conversation_history=None):
    ai_config = _resolve_ai_config(api_key_or_config)
    history_text = ""
    if conversation_history:
        for msg in conversation_history:
            role = msg.get("role", "user")
            history_text += f"\n{role.upper()}: {msg['content']}"

    prompt = f"""You are a YouTube title expert. Based on the video context and the user's feedback, suggest 8 new refined YouTube titles.

VIDEO CONTEXT:
{context}

CONVERSATION HISTORY:{history_text}

USER'S NEW REQUEST:
{user_message}

OUTPUT JSON:
{{
  "titles": ["title1", "title2"]
}}"""

    result = chat_json(ai_config, prompt, model=ai_config.text_model)
    if "titles" not in result:
        result["titles"] = ["Could not refine titles - please try again"]
    return result


def generate_thumbnail(api_key_or_config, title, session_id, face_image_path=None, bg_image_path=None, extra_prompt="", count=3, video_context=""):
    ai_config = _resolve_ai_config(api_key_or_config)

    if not ai_config.is_gemini():
        hook_prompt = f"""Create 3 short YouTube thumbnail hook phrases in ALL CAPS.
Video title: {title}
Video context: {video_context}
Extra instructions: {extra_prompt}
Return JSON: {{"headlines": ["...", "...", "..."]}}"""
        try:
            headline_plan = chat_json(ai_config, hook_prompt, model=ai_config.text_model)
            headline_candidates = headline_plan.get("headlines", [])
        except Exception:
            headline_candidates = []
        return _compose_local_thumbnail(
            title,
            session_id,
            face_image_path=face_image_path,
            bg_image_path=bg_image_path,
            extra_prompt=extra_prompt,
            count=count,
            video_context=video_context,
            headline_candidates=headline_candidates,
        )

    client = genai.Client(api_key=ai_config.api_key)
    output_dir = os.path.join("output", "thumbnails", session_id)
    os.makedirs(output_dir, exist_ok=True)
    prompt_parts = []
    if face_image_path and os.path.exists(face_image_path):
        prompt_parts.append(Image.open(face_image_path))
    if bg_image_path and os.path.exists(bg_image_path):
        prompt_parts.append(Image.open(bg_image_path))

    prompt_parts.append(
        f"""Generate a professional, eye-catching YouTube thumbnail image.

VIDEO TITLE: "{title}"
VIDEO CONTEXT:
{video_context}
EXTRA INSTRUCTIONS:
{extra_prompt}
"""
    )

    thumbnails = []
    for i in range(count):
        response = client.models.generate_content(
            model=ai_config.image_model or "gemini-3.1-flash-image-preview",
            contents=prompt_parts,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="16:9",
                    image_size="2K"
                )
            )
        )
        for part in response.parts:
            if image := part.as_image():
                filename = f"thumb_{i + 1}.jpg"
                filepath = os.path.join(output_dir, filename)
                image.save(filepath)
                thumbnails.append(f"/thumbnails/{session_id}/{filename}")
                break

    return thumbnails


def generate_youtube_description(api_key_or_config, title, transcript_segments, language, video_duration):
    ai_config = _resolve_ai_config(api_key_or_config)
    formatted_segments = []
    for seg in transcript_segments:
        start = seg.get("start", 0)
        mins = int(start // 60)
        secs = int(start % 60)
        timestamp = f"{mins}:{secs:02d}"
        formatted_segments.append(f"[{timestamp}] {seg.get('text', '').strip()}")

    segments_text = "\n".join(formatted_segments)
    dur_mins = int(video_duration // 60)
    dur_secs = int(video_duration % 60)
    duration_str = f"{dur_mins}:{dur_secs:02d}"
    prompt = f"""You are a YouTube SEO expert. Generate a complete YouTube video description for the following video.

VIDEO TITLE: "{title}"
VIDEO LANGUAGE: {language}
VIDEO DURATION: {duration_str}

TRANSCRIPT WITH TIMESTAMPS:
{segments_text}

Return ONLY the description text."""
    description = chat_json(ai_config, f'{prompt}\nReturn JSON: {{"description":"..."}}', model=ai_config.text_model).get("description")
    if not description:
        description = chat_json(ai_config, prompt, model=ai_config.text_model).get("description", "")
    return {"description": description or ""}
