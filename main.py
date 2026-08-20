# LEGACY WORKER: Invoked by the Go control plane for media/AI generation.
import time
import cv2
import subprocess
import argparse
import threading
import re
import sys
import os
import shutil
import numpy as np
import httpx
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit, urlunsplit

try:
    from tqdm import tqdm
except ImportError:  # pragma: no cover - production installs tqdm
    class _TqdmFallback:
        def __init__(self, iterable=None, **_kwargs):
            self.iterable = iterable

        def __iter__(self):
            return iter(self.iterable or ())

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def update(self, _count=1):
            return None

        def close(self):
            return None

    tqdm = _TqdmFallback

try:
    import yt_dlp
except ImportError:  # pragma: no cover - required only for URL ingestion
    yt_dlp = None

from dotenv import load_dotenv
import json
from pathlib import Path

import warnings
warnings.filterwarnings("ignore", category=UserWarning, module='google.protobuf')
from ai_client import load_ai_config, chat_json
from highlight_generation import transcribe_video_with_config
from master_policy import master_video_encode_args, choose_master_spec, master_video_filter
from media_probe import probe_media
from render_manifest import register_asset, register_remote_asset, save_manifest_atomic
from minio_sources import validate_source_object
from crop_track import CropKeyframe, CropRect, CropScene, CropTrack
from clip_timeline import resolve_clip_frame_range
from streamer_layout import (
    STREAMER_STACK_LAYOUT,
    compose_streamer_stack_frame,
    filter_candidates_inside_gameplay_region,
    filter_candidates_outside_webcam_region,
    normalize_clip_layout,
    normalize_gameplay_region,
    normalize_gameplay_zoom,
    normalize_webcam_region,
)
from video_analysis import SourceAnalysis, load_or_build_source_analysis
from video_output_validation import validate_clip_output
from video_frames import FFmpegVideoStream
from video_rendering import build_audio_extract_command
from video_metrics import JobVideoMetrics
from runtime_acceleration import preferred_device
from subtitles import build_subtitle_segments, burn_subtitles, generate_srt

# Load environment variables
load_dotenv()

# --- Constants ---
ASPECT_RATIO = 9 / 16
DIRECT_VIDEO_MAX_BYTES = int(os.environ.get("MAX_FILE_SIZE_MB", "2048")) * 1024 * 1024
DEFAULT_SCENE_FRAME_SKIP = 2
SCENE_STRATEGY_MAX_DIMENSION = 640
SCENE_DETECTION_MAX_DIMENSION = 480
DEFAULT_SCENE_STRATEGY_SAMPLE_COUNT = 1
MAX_SCENE_STRATEGY_SAMPLE_COUNT = 3
DEFAULT_SCENE_STRATEGY_WORKERS = max(1, min(8, os.cpu_count() or 1))
MAX_SCENE_STRATEGY_WORKERS = 32


def should_run_person_detection(
    frame_number,
    scene_start_frame,
    last_detection_frame,
    source_fps,
    interval_seconds=1.5,
):
    """Return whether the periodic YOLO fallback should run for this frame."""
    if frame_number == scene_start_frame or last_detection_frame < 0:
        return True
    interval_frames = max(1, round(source_fps * max(1.0, interval_seconds)))
    return frame_number - last_detection_frame >= interval_frames


def scene_detection_frame_skip() -> int:
    raw_value = os.environ.get("SCENE_DETECTION_FRAME_SKIP", str(DEFAULT_SCENE_FRAME_SKIP))
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_SCENE_FRAME_SKIP
    return value if value >= 0 else DEFAULT_SCENE_FRAME_SKIP


def scene_strategy_sample_count() -> int:
    raw_value = os.environ.get(
        "SCENE_STRATEGY_SAMPLE_COUNT", str(DEFAULT_SCENE_STRATEGY_SAMPLE_COUNT)
    )
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_SCENE_STRATEGY_SAMPLE_COUNT
    return min(max(value, 1), MAX_SCENE_STRATEGY_SAMPLE_COUNT)


def scene_strategy_workers() -> int:
    raw_value = os.environ.get(
        "SCENE_STRATEGY_WORKERS", str(DEFAULT_SCENE_STRATEGY_WORKERS)
    )
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_SCENE_STRATEGY_WORKERS
    return min(max(value, 1), MAX_SCENE_STRATEGY_WORKERS)

GEMINI_PROMPT_TEMPLATE = """
You are a senior short-form video editor. Read the supplied timestamped transcript segments and choose the strongest viral moments for TikTok/IG Reels/YouTube Shorts. Each clip must be between 15 and 60 seconds long.

TARGET_CLIP_COUNT: {target_clips}

Return at most TARGET_CLIP_COUNT candidates from this transcript window. Do not stop early unless the window genuinely has fewer strong moments.

⚠️ FFMPEG TIME CONTRACT — STRICT REQUIREMENTS:
- Return timestamps in ABSOLUTE SECONDS from the start of the video (usable in: ffmpeg -ss <start> -to <end> -i <input> ...).
- Only NUMBERS with decimal point, up to 3 decimals (examples: 0, 1.250, 17.350).
- Ensure 0 ≤ start < end ≤ VIDEO_DURATION_SECONDS.
- Each clip between 15 and 60 s (inclusive).
- Prefer starting 0.2–0.4 s BEFORE the hook and ending 0.2–0.4 s AFTER the payoff.
- Use silence moments for natural cuts; never cut in the middle of a word or phrase.
- STRICTLY FORBIDDEN to use time formats other than absolute seconds.

VIDEO_DURATION_SECONDS: {video_duration}

ORIGINAL SOURCE CONTEXT (grounded facts only; may be unavailable):
{source_context}
Use this context to improve titles, descriptions, and hooks. Do not invent identities, locations, dates, events, or entities that are not supported by the context or transcript.

TIMESTAMPED_TRANSCRIPT_SEGMENTS (each segment has absolute start/end seconds):
{transcript_segments}

STRICT EXCLUSIONS:
- No generic intros/outros or purely sponsorship segments unless they contain the hook.
- No clips < 15 s or > 60 s.

OUTPUT — RETURN ONLY VALID JSON (no markdown, no comments). Order clips by predicted performance (best to worst). In the descriptions, ALWAYS include a compelling, context-aware Call-To-Action (CTA) tailored specifically to the video type/content and in the same language as the transcript (e.g. for tutorials/tools: comment for the template/guide; for music/creative: use this audio, tag friends or drop a reaction; for podcast/discussions: share opinions in comments; for entertainment/gaming: follow for part 2, save or share):
{{
  "shorts": [
    {{
      "start": <number in seconds, e.g., 12.340>,
      "end": <number in seconds, e.g., 37.900>,
      "score": <number from 0 to 1>,
      "video_description_for_tiktok": "<description for TikTok oriented to get views with contextual CTA>",
      "video_description_for_instagram": "<description for Instagram oriented to get views with contextual CTA>",
      "video_title_for_youtube_short": "<title for YouTube Short oriented to get views 100 chars max>",
      "viral_hook_text": "<SHORT punchy text overlay (max 10 words). MUST BE IN THE SAME LANGUAGE AS THE VIDEO TRANSCRIPT. Examples: 'POV: You realized...', 'Did you know?', 'Stop doing this!'>"
    }}
  ]
}}
"""

CLIP_ANALYSIS_MAX_CHUNK_CHARS = 24000
CLIP_ANALYSIS_MAX_PROMPT_CHARS = 32000

# Load the YOLO model once for GPU-backed face/person analysis and fallback framing.
model = None
_yolo_inference_lock = threading.Lock()

class SmoothedCameraman:
    """
    Handles smooth camera movement.
    Simplified Logic: "Heavy Tripod"
    Only moves if the subject leaves the center safe zone.
    Moves slowly and linearly.
    """
    def __init__(self, output_width, output_height, video_width, video_height):
        self.output_width = output_width
        self.output_height = output_height
        self.video_width = video_width
        self.video_height = video_height
        
        # Initial State
        self.current_center_x = video_width / 2
        self.target_center_x = video_width / 2
        
        # Calculate crop dimensions once
        self.crop_height = video_height
        self.crop_width = int(self.crop_height * ASPECT_RATIO)
        if self.crop_width > video_width:
             self.crop_width = video_width
             self.crop_height = int(self.crop_width / ASPECT_RATIO)
             
        # Safe Zone: 20% of the video width
        # As long as the target is within this zone relative to current center, DO NOT MOVE.
        self.safe_zone_radius = self.crop_width * 0.25

    def update_target(self, face_box):
        """
        Updates the target center based on detected face/person.
        """
        if face_box:
            x, y, w, h = face_box
            self.target_center_x = x + w / 2
    
    def get_crop_box(self, force_snap=False):
        """
        Returns the (x1, y1, x2, y2) for the current frame.
        """
        if force_snap:
            self.current_center_x = self.target_center_x
        else:
            diff = self.target_center_x - self.current_center_x
            
            # SIMPLIFIED LOGIC:
            # 1. Is the target outside the safe zone?
            if abs(diff) > self.safe_zone_radius:
                # 2. If yes, move towards it slowly (Linear Speed)
                # Determine direction
                direction = 1 if diff > 0 else -1
                
                # Speed: 2 pixels per frame (Slow pan)
                # If the distance is HUGE (scene change or fast movement), speed up slightly
                if abs(diff) > self.crop_width * 0.5:
                    speed = 15.0 # Fast re-frame
                else:
                    speed = 3.0  # Slow, steady pan
                
                self.current_center_x += direction * speed
                
                # Check if we overshot (prevent oscillation)
                new_diff = self.target_center_x - self.current_center_x
                if (direction == 1 and new_diff < 0) or (direction == -1 and new_diff > 0):
                    self.current_center_x = self.target_center_x
            
            # If inside safe zone, DO NOTHING (Stationary Camera)
                
        # Clamp center
        half_crop = self.crop_width / 2
        
        if self.current_center_x - half_crop < 0:
            self.current_center_x = half_crop
        if self.current_center_x + half_crop > self.video_width:
            self.current_center_x = self.video_width - half_crop
            
        x1 = int(self.current_center_x - half_crop)
        x2 = int(self.current_center_x + half_crop)
        
        x1 = max(0, x1)
        x2 = min(self.video_width, x2)
        
        y1 = 0
        y2 = self.video_height
        
        return x1, y1, x2, y2

class SpeakerTracker:
    """
    Tracks speakers over time to prevent rapid switching and handle temporary obstructions.
    """
    def __init__(self, stabilization_frames=15, cooldown_frames=30):
        self.active_speaker_id = None
        self.speaker_scores = {}  # {id: score}
        self.last_seen = {}       # {id: frame_number}
        self.locked_counter = 0   # How long we've been locked on current speaker
        
        # Hyperparameters
        self.stabilization_threshold = stabilization_frames # Frames needed to confirm a new speaker
        self.switch_cooldown = cooldown_frames              # Minimum frames before switching again
        self.last_switch_frame = -1000
        
        # ID tracking
        self.next_id = 0
        self.known_faces = [] # [{'id': 0, 'center': x, 'last_frame': 123}]

    def get_target(self, face_candidates, frame_number, width):
        """
        Decides which face to focus on.
        face_candidates: list of {'box': [x,y,w,h], 'score': float}
        """
        current_candidates = []
        
        # 1. Match faces to known IDs (simple distance tracking)
        for face in face_candidates:
            x, y, w, h = face['box']
            center_x = x + w / 2
            
            best_match_id = -1
            min_dist = width * 0.15 # Reduced matching radius to avoid jumping in groups
            
            # Try to match with known faces seen recently
            for kf in self.known_faces:
                if frame_number - kf['last_frame'] > 30: # Forgot faces older than 1s (was 2s)
                    continue
                    
                dist = abs(center_x - kf['center'])
                if dist < min_dist:
                    min_dist = dist
                    best_match_id = kf['id']
            
            # If no match, assign new ID
            if best_match_id == -1:
                best_match_id = self.next_id
                self.next_id += 1
            
            # Update known face
            self.known_faces = [kf for kf in self.known_faces if kf['id'] != best_match_id]
            self.known_faces.append({'id': best_match_id, 'center': center_x, 'last_frame': frame_number})
            
            current_candidates.append({
                'id': best_match_id,
                'box': face['box'],
                'score': face['score']
            })

        # 2. Update Scores with decay
        for pid in list(self.speaker_scores.keys()):
             self.speaker_scores[pid] *= 0.85 # Faster decay (was 0.9)
             if self.speaker_scores[pid] < 0.1:
                 del self.speaker_scores[pid]

        # Add new scores
        for cand in current_candidates:
            pid = cand['id']
            # Score is purely based on size (proximity) now that we don't have mouth
            raw_score = cand['score'] / (width * width * 0.05)
            self.speaker_scores[pid] = self.speaker_scores.get(pid, 0) + raw_score

        # 3. Determine Best Speaker
        if not current_candidates:
            # If no one found, maintain last active speaker if cooldown allows
            # to avoid black screen or jump to 0,0
            return None 
            
        best_candidate = None
        max_score = -1
        
        for cand in current_candidates:
            pid = cand['id']
            total_score = self.speaker_scores.get(pid, 0)
            
            # Hysteresis: HUGE Bonus for current active speaker
            if pid == self.active_speaker_id:
                total_score *= 3.0 # Sticky factor
                
            if total_score > max_score:
                max_score = total_score
                best_candidate = cand

        # 4. Decide Switch
        if best_candidate:
            target_id = best_candidate['id']
            
            if target_id == self.active_speaker_id:
                self.locked_counter += 1
                return best_candidate['box']
            
            # New person
            if frame_number - self.last_switch_frame < self.switch_cooldown:
                old_cand = next((c for c in current_candidates if c['id'] == self.active_speaker_id), None)
                if old_cand:
                    return old_cand['box']
            
            self.active_speaker_id = target_id
            self.last_switch_frame = frame_number
            self.locked_counter = 0
            return best_candidate['box']
            
        return None

def _get_yolo_model():
    global model
    if model is None:
        with _yolo_inference_lock:
            if model is None:
                from ultralytics import YOLO

                model = YOLO("yolov8n.pt")
    return model


def _run_yolo_person_detection(frame, detector=None):
    detector = detector or _get_yolo_model()
    device = preferred_device()
    with _yolo_inference_lock:
        try:
            return detector(frame, verbose=False, classes=[0], device=device)
        except Exception:
            if device != "cuda":
                raise
            return detector(frame, verbose=False, classes=[0], device="cpu")


def _yolo_person_boxes(frame, detector=None):
    for result in _run_yolo_person_detection(frame, detector=detector) or []:
        for box in result.boxes:
            x1, y1, x2, y2 = [int(value) for value in box.xyxy[0]]
            width = x2 - x1
            height = y2 - y1
            if width > 0 and height > 0:
                yield x1, y1, width, height


def detect_face_candidates(frame, detector=None):
    """Return GPU-backed face-region candidates from detected people."""
    candidates = []
    for x, y, width, height in _yolo_person_boxes(frame, detector=detector):
        face_height = max(1, int(height * 0.4))
        candidates.append({
            "box": [x, y, width, face_height],
            "score": width * face_height,
        })
    return candidates


def _count_scene_faces(frame):
    return len(detect_face_candidates(frame))


def resize_scene_strategy_frame(frame, max_dimension=SCENE_STRATEGY_MAX_DIMENSION):
    """Bound face-analysis resolution without changing final render inputs."""
    height, width = frame.shape[:2]
    longest_side = max(height, width)
    if longest_side <= max_dimension:
        return frame

    scale = float(max_dimension) / float(longest_side)
    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))
    return cv2.resize(
        frame,
        (resized_width, resized_height),
        interpolation=cv2.INTER_AREA,
    )


def detect_person_yolo(frame):
    """
    Fallback: Detect largest person using YOLO when face detection fails.
    Returns [x, y, w, h] of the person's 'upper body' approximation.
    """
    best_box = None
    max_area = 0
    for x, y, width, height in _yolo_person_boxes(frame):
        area = width * height
        if area > max_area:
            max_area = area
            # Focus on the top 40% of the person (head/chest) for framing.
            best_box = [x, y, width, max(1, int(height * 0.4))]

    return best_box

def create_general_frame(frame, output_width, output_height):
    """
    Creates a 'General Shot' frame: 
    - Background: Blurred zoom of original
    - Foreground: Original video scaled to fit width, centered vertically.
    """
    orig_h, orig_w = frame.shape[:2]
    
    # 1. Background (Fill Height)
    # Crop center to aspect ratio
    bg_scale = output_height / orig_h
    bg_w = int(orig_w * bg_scale)
    bg_resized = cv2.resize(frame, (bg_w, output_height))
    
    # Crop center of background
    start_x = (bg_w - output_width) // 2
    if start_x < 0: start_x = 0
    background = bg_resized[:, start_x:start_x+output_width]
    if background.shape[1] != output_width:
        background = cv2.resize(background, (output_width, output_height))
        
    # Blur background
    background = cv2.GaussianBlur(background, (51, 51), 0)
    
    # 2. Foreground (Fit Width)
    scale = output_width / orig_w
    fg_h = int(orig_h * scale)
    foreground = cv2.resize(frame, (output_width, fg_h))
    
    # 3. Overlay
    y_offset = (output_height - fg_h) // 2
    
    # Clone background to avoid modifying it
    final_frame = background.copy()
    final_frame[y_offset:y_offset+fg_h, :] = foreground
    
    return final_frame

def _scene_strategy_sample_positions(start_frame, end_frame, sample_count):
    if sample_count == 1:
        positions = [int((start_frame + end_frame) / 2)]
    else:
        positions = [start_frame + 5, int((start_frame + end_frame) / 2), end_frame - 5]

    last_frame = max(start_frame, end_frame - 1)
    return list(dict.fromkeys(max(start_frame, min(last_frame, position)) for position in positions))


def _scene_strategy_decision(face_counts):
    avg_faces = sum(face_counts) / len(face_counts) if face_counts else 0
    return "GENERAL" if avg_faces > 1.2 or avg_faces < 0.5 else "TRACK"


def analyze_scenes_strategy(
    video_path,
    scenes,
    *,
    max_dimension=SCENE_STRATEGY_MAX_DIMENSION,
    sample_count=DEFAULT_SCENE_STRATEGY_SAMPLE_COUNT,
    workers=DEFAULT_SCENE_STRATEGY_WORKERS,
    metrics=None,
    frame_start=None,
    frame_end=None,
    source_media=None,
):
    """
    Analyzes each scene to determine if it should be TRACK (Single person) or GENERAL (Group/Wide).
    Returns list of strategies corresponding to scenes.
    """
    if not scenes:
        return []

    sample_count = min(max(int(sample_count), 1), MAX_SCENE_STRATEGY_SAMPLE_COUNT)

    scene_positions = []
    position_to_scenes = {}
    for scene_index, (start, end) in enumerate(scenes):
        start_frame = int(getattr(start, "frame_num", start))
        end_frame = int(getattr(end, "frame_num", end))
        positions = _scene_strategy_sample_positions(
            start_frame, end_frame, sample_count
        )
        scene_positions.append(positions)
        for position in positions:
            position_to_scenes.setdefault(position, []).append(scene_index)

    source_media = source_media or probe_media(video_path)
    total_frames = int(
        source_media.frame_count
        or round(float(source_media.duration_seconds) * float(source_media.fps))
    )
    first_frame = int(frame_start or 0)
    last_sample_frame = max(position_to_scenes)
    if frame_end is not None:
        last_sample_frame = min(last_sample_frame, int(frame_end) - 1)
    stream_end = min(total_frames, last_sample_frame + 1)
    cap = FFmpegVideoStream(
        video_path,
        width=source_media.width,
        height=source_media.height,
        fps=source_media.fps,
        total_frames=total_frames,
        start_frame=first_frame,
        end_frame=stream_end,
        max_dimension=max_dimension,
    )
    strategies = ["GENERAL"] * len(scenes)
    face_counts = [[] for _ in scenes]
    decoded_samples = [0] * len(scenes)
    progress = tqdm(total=len(scenes), desc="   Analyzing Scenes")
    worker_count = min(
        min(max(int(workers), 1), MAX_SCENE_STRATEGY_WORKERS),
        len(scenes),
    )
    detector_pool = ThreadPoolExecutor(max_workers=worker_count)
    pending_frames = []

    def flush_pending_frames():
        if not pending_frames:
            return
        pending_scene_indexes = [item[0] for item in pending_frames]
        pending_images = [item[1] for item in pending_frames]
        detected_face_counts = detector_pool.map(_count_scene_faces, pending_images)
        for target_scenes, face_count in zip(
            pending_scene_indexes, detected_face_counts
        ):
            for scene_index in target_scenes:
                face_counts[scene_index].append(face_count)
                decoded_samples[scene_index] += 1
                if decoded_samples[scene_index] == len(scene_positions[scene_index]):
                    strategies[scene_index] = _scene_strategy_decision(
                        face_counts[scene_index]
                    )
                    progress.update(1)
        pending_frames.clear()

    try:
        is_opened = getattr(cap, "isOpened", lambda: True)
        if not is_opened():
            return ["TRACK"] * len(scenes)

        while cap.frame_number <= last_sample_frame:
            frame = cap.read()
            if frame is False:
                break

            frame_number = cap.frame_number - 1
            target_scenes = position_to_scenes.get(frame_number)
            if target_scenes:
                analysis_frame = resize_scene_strategy_frame(frame, max_dimension)
                analysis_frame.flags.writeable = False
                pending_frames.append((target_scenes, analysis_frame))
                if len(pending_frames) >= worker_count:
                    flush_pending_frames()
        flush_pending_frames()
    finally:
        cap.close()
        detector_pool.shutdown(wait=True)
        progress.close()

    if metrics is not None:
        metrics.increment("scene_strategy_samples", sum(decoded_samples))

    return strategies

def detect_scenes(
    video_path,
    *,
    frame_skip=None,
    start_frame=None,
    end_frame=None,
    source_media=None,
):
    try:
        from scenedetect import SceneManager
        from scenedetect.detectors import ContentDetector
    except ImportError as error:
        raise RuntimeError("PySceneDetect is required for scene analysis") from error

    if frame_skip is None:
        frame_skip = scene_detection_frame_skip()

    source_media = source_media or probe_media(video_path)
    total_frames = int(
        source_media.frame_count
        or round(float(source_media.duration_seconds) * float(source_media.fps))
    )
    video = FFmpegVideoStream(
        video_path,
        width=source_media.width,
        height=source_media.height,
        fps=source_media.fps,
        total_frames=total_frames,
        start_frame=int(start_frame or 0),
        end_frame=end_frame,
        max_dimension=SCENE_DETECTION_MAX_DIMENSION,
    )
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector())
    try:
        scene_manager.detect_scenes(video=video, frame_skip=frame_skip)
        scene_list = scene_manager.get_scene_list()
    finally:
        fps = float(video.frame_rate)
        video.close()
    if start_frame is not None or end_frame is not None:
        bounded_scenes = []
        lower = int(start_frame or 0)
        upper = int(end_frame) if end_frame is not None else None
        for start, end in scene_list:
            start_number = int(getattr(start, "frame_num", start))
            end_number = int(getattr(end, "frame_num", end))
            if end_number <= lower or (upper is not None and start_number >= upper):
                continue
            bounded_scenes.append((max(start_number, lower), min(end_number, upper) if upper is not None else end_number))
        scene_list = bounded_scenes
    return scene_list, fps

def get_video_resolution(video_path):
    media = probe_media(video_path)
    return media.width, media.height


def prepare_opencv_video(input_video: str) -> str:
    """Keep the original source; FFmpeg decodes AV1 directly when frames are needed."""
    return input_video


def build_source_analysis_for_job(
    input_video: str,
    output_dir: str,
    *,
    metrics: JobVideoMetrics | None = None,
    cache_name: str = "_source_analysis.json",
    frame_start: int | None = None,
    frame_end: int | None = None,
) -> SourceAnalysis:
    """Build or load the expensive source analysis shared by all clip renders."""
    source_path = Path(input_video).resolve()
    source_media = probe_media(source_path)
    scene_frame_skip = scene_detection_frame_skip()
    scene_strategy_max_dimension = SCENE_STRATEGY_MAX_DIMENSION
    scene_detection_max_dimension = SCENE_DETECTION_MAX_DIMENSION
    scene_strategy_sample_count_value = scene_strategy_sample_count()
    scene_strategy_worker_count = scene_strategy_workers()
    source_fps = float(source_media.fps)
    total_frames = int(
        source_media.frame_count
        or round(float(source_media.duration_seconds) * source_fps)
    )
    width = int(source_media.width)
    height = int(source_media.height)

    if source_fps <= 0 or total_frames <= 0 or width <= 0 or height <= 0:
        raise ValueError("source video metadata is incomplete or invalid")

    stat = source_path.stat()
    source_fingerprint = {
        "path": str(source_path),
        "size": int(stat.st_size),
        "mtime_ns": int(stat.st_mtime_ns),
        "codec": source_media.codec,
        "fps": source_fps,
        "frame_count": total_frames,
        "width": width,
        "height": height,
        "scene_frame_skip": scene_frame_skip,
        "scene_strategy_max_dimension": scene_strategy_max_dimension,
        "scene_detection_max_dimension": scene_detection_max_dimension,
        "scene_strategy_sample_count": scene_strategy_sample_count_value,
    }
    if frame_start is not None:
        source_fingerprint["analysis_frame_start"] = int(frame_start)
    if frame_end is not None:
        source_fingerprint["analysis_frame_end"] = int(frame_end)

    def scene_builder():
        started = time.monotonic()
        try:
            scene_kwargs = {"frame_skip": scene_frame_skip}
            if frame_start is not None:
                scene_kwargs["start_frame"] = int(frame_start)
            if frame_end is not None:
                scene_kwargs["end_frame"] = int(frame_end)
            scenes, _detected_fps = detect_scenes(
                str(source_path), source_media=source_media, **scene_kwargs
            )
            if scenes:
                return scenes
            return [(
                int(frame_start or 0),
                int(frame_end if frame_end is not None else total_frames),
            )]
        finally:
            if metrics is not None:
                metrics.add_duration("scene_detection", time.monotonic() - started)
                metrics.increment("scene_frame_skip", scene_frame_skip)

    def strategy_builder(scenes):
        started = time.monotonic()
        try:
            kwargs = {
                "max_dimension": scene_strategy_max_dimension,
                "sample_count": scene_strategy_sample_count_value,
                "workers": scene_strategy_worker_count,
            }
            if metrics is not None:
                kwargs["metrics"] = metrics
            if frame_start is not None:
                kwargs["frame_start"] = int(frame_start)
            if frame_end is not None:
                kwargs["frame_end"] = int(frame_end)
            kwargs["source_media"] = source_media
            return analyze_scenes_strategy(str(source_path), scenes, **kwargs)
        finally:
            if metrics is not None:
                metrics.add_duration("scene_strategy", time.monotonic() - started)

    load_kwargs = {
        "cache_path": Path(output_dir) / cache_name,
        "source_fingerprint": source_fingerprint,
        "source_fps": source_fps,
        "total_frames": total_frames,
        "width": width,
        "height": height,
        "scene_builder": scene_builder,
        "strategy_builder": strategy_builder,
    }
    if metrics is not None:
        load_kwargs["cache_status_callback"] = lambda status: metrics.set_cache_status(
            "source_analysis", status
        )
        with metrics.timed("scene_analysis"):
            return load_or_build_source_analysis(**load_kwargs)
    return load_or_build_source_analysis(**load_kwargs)


def build_clip_source_analysis_for_job(
    input_video: str,
    output_dir: str,
    *,
    clip_index: int,
    start_sec: float,
    end_sec: float,
    metrics: JobVideoMetrics | None = None,
) -> SourceAnalysis:
    """Build a cached analysis limited to one candidate clip's frame range."""
    media = probe_media(input_video)
    if media.fps <= 0 or media.frame_count <= 0:
        raise ValueError("clip source metadata is incomplete or invalid")
    trim = resolve_clip_frame_range(
        start_sec,
        end_sec,
        source_fps=float(media.fps),
        total_frames=int(media.frame_count),
    )
    return build_source_analysis_for_job(
        input_video,
        output_dir,
        metrics=metrics,
        cache_name=f"_clip_{int(clip_index)}_analysis.json",
        frame_start=trim.start_frame,
        frame_end=trim.end_frame,
    )


def sanitize_filename(filename):
    """Remove invalid characters from filename."""
    filename = re.sub(r'[<>:"/\\|?*#]', '', filename)
    filename = filename.replace(' ', '_')
    return filename[:100]


def parse_source_object_argument(value: str | None) -> dict | None:
    """Parse and validate the optional MinIO source reference passed to the CLI."""
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("source object must be valid JSON") from exc
    bucket, key = validate_source_object(parsed)
    return {"bucket": bucket, "key": key}


SOURCE_CONTEXT_KEYS = (
    "who",
    "what",
    "where",
    "when",
    "entities",
    "source_summary",
    "confidence",
)
SOURCE_CONTEXT_MAX_TEXT = 1200
SOURCE_CONTEXT_MAX_DESCRIPTION = 2400
SOURCE_CONTEXT_MAX_LIST_ITEMS = 20


def _bounded_text(value, limit=SOURCE_CONTEXT_MAX_TEXT):
    text = str(value or "").strip()
    return text[:limit]


def _bounded_list(value, limit=SOURCE_CONTEXT_MAX_LIST_ITEMS, item_limit=160):
    if not isinstance(value, (list, tuple)):
        return []
    return [_bounded_text(item, item_limit) for item in value if str(item or "").strip()][:limit]


def _normalize_source_metadata(info, source_url):
    """Keep only bounded, serializable metadata useful for source context."""
    if not isinstance(info, dict):
        raise ValueError("Source metadata extractor returned an invalid payload")

    extractor = str(info.get("extractor_key") or info.get("extractor") or "").strip().lower()
    if "twitch" in extractor:
        platform = "twitch"
    elif "youtube" in extractor or "youtu" in extractor:
        platform = "youtube"
    else:
        platform = extractor or "unknown"

    metadata = {
        "platform": platform,
        "id": _bounded_text(info.get("id"), 160),
        "title": _bounded_text(info.get("title")),
        "channel": _bounded_text(info.get("channel") or info.get("uploader")),
        "description": _bounded_text(info.get("description"), SOURCE_CONTEXT_MAX_DESCRIPTION),
        "upload_date": _bounded_text(info.get("upload_date"), 32),
        "categories": _bounded_list(info.get("categories"), 10, 120),
        "tags": _bounded_list(info.get("tags"), SOURCE_CONTEXT_MAX_LIST_ITEMS, 120),
        "view_count": info.get("view_count"),
        "duration": info.get("duration"),
        "thumbnail": _bounded_text(info.get("thumbnail"), 500),
        "webpage_url": _bounded_text(info.get("webpage_url") or source_url, 1000),
        "source_url": _bounded_text(source_url, 1000),
    }
    if not isinstance(metadata["view_count"], (int, float)):
        metadata["view_count"] = None
    if not isinstance(metadata["duration"], (int, float)):
        metadata["duration"] = None
    return metadata


def fetch_source_metadata(source_url):
    """Read YouTube/Twitch metadata without downloading source media."""
    if yt_dlp is None:
        raise RuntimeError("yt-dlp is required for source metadata lookup")

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "cachedir": False,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(source_url, download=False)
    return _normalize_source_metadata(info, source_url)


def _default_source_context(source_metadata):
    channel = source_metadata.get("channel", "") if isinstance(source_metadata, dict) else ""
    title = source_metadata.get("title", "") if isinstance(source_metadata, dict) else ""
    upload_date = source_metadata.get("upload_date", "") if isinstance(source_metadata, dict) else ""
    categories = source_metadata.get("categories", []) if isinstance(source_metadata, dict) else []
    tags = source_metadata.get("tags", []) if isinstance(source_metadata, dict) else []
    description = source_metadata.get("description", "") if isinstance(source_metadata, dict) else ""
    return {
        "who": [channel] if channel else [],
        "what": title,
        "where": "",
        "when": upload_date,
        "entities": _bounded_list([*categories, *tags], 20, 120),
        "source_summary": _bounded_text(description or title),
        "confidence": "low",
    }


def normalize_source_context(value):
    """Normalize model output to the small persisted source-context schema."""
    value = value if isinstance(value, dict) else {}
    confidence = str(value.get("confidence") or "low").strip().lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "low"
    return {
        "who": _bounded_list(value.get("who")),
        "what": _bounded_text(value.get("what")),
        "where": _bounded_text(value.get("where")),
        "when": _bounded_text(value.get("when"), 120),
        "entities": _bounded_list(value.get("entities")),
        "source_summary": _bounded_text(value.get("source_summary"), SOURCE_CONTEXT_MAX_DESCRIPTION),
        "confidence": confidence,
    }


def synthesize_source_context(source_metadata, transcript_result):
    """Use the configured AI provider to summarize grounded source facts."""
    ai_config = load_ai_config()
    prompt = f"""Identify the who, what, where, and when of a source video using only the supplied platform metadata and transcript.
Return JSON only with exactly these keys: {json.dumps(SOURCE_CONTEXT_KEYS)}.
Use arrays for who and entities. Use empty strings or empty arrays when a fact is not supported.
Do not invent identities, locations, dates, events, or relationships. Keep confidence conservative.

SOURCE METADATA:
{json.dumps(source_metadata, ensure_ascii=False)}

TRANSCRIPT:
{_bounded_text((transcript_result or {}).get('text'), 6000)}
"""
    model_name = ai_config.analyze_model or ai_config.text_model or ("gemini-2.5-flash" if ai_config.is_gemini() else "")
    result = chat_json(
        ai_config,
        prompt,
        model=model_name,
        reasoning_effort=ai_config.analyze_reasoning_effort,
    )
    return normalize_source_context(result)


def collect_source_context(source_url, source_metadata, transcript_result):
    """Build persisted source context while keeping clip generation best-effort."""
    record = {
        "source_url": source_url,
        "source_metadata": source_metadata,
        "source_context": None,
        "source_context_status": "unavailable",
        "source_context_error": None,
    }
    try:
        record["source_context"] = synthesize_source_context(source_metadata, transcript_result)
        record["source_context_status"] = "available"
    except Exception as exc:
        record["source_context"] = _default_source_context(source_metadata)
        record["source_context_status"] = "synthesis_unavailable"
        record["source_context_error"] = _bounded_text(exc, 500)
        print(f"⚠️ Source context synthesis warning: {exc}")
    return record


def prepare_source_context(source_url, transcript_result):
    """Fetch source metadata and synthesize context without failing the job."""
    if not source_url:
        return {
            "source_url": None,
            "source_metadata": None,
            "source_context": None,
            "source_context_status": "not_requested",
            "source_context_error": None,
        }
    try:
        source_metadata = fetch_source_metadata(source_url)
    except Exception as exc:
        print(f"⚠️ Source metadata lookup warning: {exc}")
        return {
            "source_url": source_url,
            "source_metadata": None,
            "source_context": None,
            "source_context_status": "metadata_unavailable",
            "source_context_error": _bounded_text(exc, 500),
        }
    return collect_source_context(source_url, source_metadata, transcript_result)


def attach_source_context_to_clip_plan(clips_data, source_context_record):
    """Persist source fields at job level and on each generated clip."""
    if not isinstance(clips_data, dict):
        return clips_data
    for key in ("source_url", "source_metadata", "source_context", "source_context_status", "source_context_error"):
        clips_data[key] = source_context_record.get(key)
    for clip in clips_data.get("shorts", []):
        if isinstance(clip, dict):
            clip["source_url"] = source_context_record.get("source_url")
            clip["source_context"] = source_context_record.get("source_context")
    return clips_data


def resolve_direct_video_url(url: str) -> str:
    """Validate a direct media URL and map browser-loopback MinIO URLs internally."""
    raw_url = (url or "").strip()
    parsed = urlsplit(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Video URL must use http:// or https://")

    endpoint = os.environ.get("AWS_S3_ENDPOINT_URL", "").strip()
    if endpoint and parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        internal = urlsplit(endpoint)
        if internal.scheme in {"http", "https"} and internal.netloc:
            return urlunsplit((internal.scheme, internal.netloc, parsed.path, parsed.query, parsed.fragment))

    return raw_url


def download_direct_video(url: str, output_dir: str = ".") -> tuple[str, str]:
    """Stream a direct HTTP(S) video URL to a local file for clip processing."""
    resolved_url = resolve_direct_video_url(url)
    parsed = urlsplit(resolved_url)
    requested_name = os.path.basename(parsed.path.rstrip("/"))
    safe_name = sanitize_filename(requested_name) if requested_name else ""
    if not safe_name or safe_name in {".", ".."}:
        safe_name = "remote_video.mp4"
    elif not Path(safe_name).suffix:
        safe_name = f"{safe_name}.mp4"

    title = Path(safe_name).stem or "remote_video"
    os.makedirs(output_dir, exist_ok=True)
    destination_path = os.path.join(output_dir, safe_name)
    partial_path = f"{destination_path}.part"

    try:
        with httpx.stream("GET", resolved_url, follow_redirects=True, timeout=300.0) as response:
            response.raise_for_status()
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > DIRECT_VIDEO_MAX_BYTES:
                raise ValueError("Direct video URL exceeds the configured file size limit")

            written_bytes = 0
            with open(partial_path, "wb") as handle:
                for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    written_bytes += len(chunk)
                    if written_bytes > DIRECT_VIDEO_MAX_BYTES:
                        raise ValueError("Direct video URL exceeds the configured file size limit")
                    handle.write(chunk)

        os.replace(partial_path, destination_path)
    except Exception:
        if os.path.exists(partial_path):
            os.remove(partial_path)
        raise

    return destination_path, title


def download_youtube_video(url, output_dir="."):
    if yt_dlp is None:
        raise RuntimeError("yt-dlp is required for URL ingestion")

    """
    Downloads a YouTube video using yt-dlp.
    Returns the path to the downloaded video and the video title.
    """
    print(f"🔍 Debug: yt-dlp version: {yt_dlp.version.__version__}")
    print("📥 Downloading video from YouTube...")
    step_start_time = time.time()

    cookies_path = '/app/cookies.txt'
    cookies_env = os.environ.get("YOUTUBE_COOKIES")
    if cookies_env:
        print("🍪 Found YOUTUBE_COOKIES env var, creating cookies file inside container...")
        try:
            with open(cookies_path, 'w') as f:
                f.write(cookies_env)
            if os.path.exists(cookies_path):
                 print(f"   Debug: Cookies file created. Size: {os.path.getsize(cookies_path)} bytes")
                 with open(cookies_path, 'r') as f:
                     content = f.read(100)
                     print(f"   Debug: First 100 chars of cookie file: {content}")
        except Exception as e:
            print(f"⚠️ Failed to write cookies file: {e}")
            cookies_path = None
    else:
        cookies_path = None
        print("⚠️ YOUTUBE_COOKIES env var not found.")
    
    # Common yt-dlp options to work around YouTube bot detection.
    # extractor_args tries multiple player clients in order; tv_embed / android
    # avoid the OAuth/PO-token checks that block server IPs.
    _COMMON_YDL_OPTS = {
        'quiet': False,
        'verbose': True,
        'no_warnings': False,
        'cookiefile': cookies_path if cookies_path else None,
        'socket_timeout': 30,
        'retries': 10,
        'fragment_retries': 10,
        'nocheckcertificate': True,
        'cachedir': False,
        'extractor_args': {
            'youtube': {
                'player_client': ['tv_embed', 'android', 'mweb', 'web'],
                'player_skip': ['webpage', 'configs'],
            }
        },
        'http_headers': {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
        },
    }

    with yt_dlp.YoutubeDL(_COMMON_YDL_OPTS) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            video_title = info.get('title', 'youtube_video')
            sanitized_title = sanitize_filename(video_title)
        except Exception as e:
            # Force print to stderr/stdout immediately so it's captured before crash
            import sys
            import traceback
            
            # Print minimal error first to ensure something gets out
            print("🚨 YOUTUBE DOWNLOAD ERROR 🚨", file=sys.stderr)
            
            error_msg = f"""
            
❌ ================================================================= ❌
❌ FATAL ERROR: YOUTUBE DOWNLOAD FAILED
❌ ================================================================= ❌
            
REASON: YouTube has blocked the download request (Error 429/Unavailable).
        This is likely a temporary IP ban on this server.

👇 SOLUTION FOR USER 👇
---------------------------------------------------------------------
1. Download the video manually to your computer.
2. Use the 'Upload Video' tab in this app to process it.
---------------------------------------------------------------------

Technical Details: {str(e)}
            """
            # Print to both streams to ensure capture
            print(error_msg, file=sys.stdout)
            print(error_msg, file=sys.stderr)
            
            # Force flush
            sys.stdout.flush()
            sys.stderr.flush()
            
            # Wait a split second to allow buffer to drain before raising
            time.sleep(0.5)
            
            raise e
    
    output_template = os.path.join(output_dir, f'{sanitized_title}.%(ext)s')
    expected_file = os.path.join(output_dir, f'{sanitized_title}.mp4')
    if os.path.exists(expected_file):
        os.remove(expected_file)
        print(f"🗑️  Removed existing file to re-download with H.264 codec")
    
    ydl_opts = {
        **_COMMON_YDL_OPTS,
        'format': 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/best[ext=mp4]/best',
        'outtmpl': output_template,
        'merge_output_format': 'mp4',
        'overwrites': True,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    
    downloaded_file = os.path.join(output_dir, f'{sanitized_title}.mp4')
    
    if not os.path.exists(downloaded_file):
        for f in os.listdir(output_dir):
            if f.startswith(sanitized_title) and f.endswith('.mp4'):
                downloaded_file = os.path.join(output_dir, f)
                break
    
    step_end_time = time.time()
    print(f"✅ Video downloaded in {step_end_time - step_start_time:.2f}s: {downloaded_file}")
    
    return downloaded_file, sanitized_title

def process_video_to_vertical(
    input_video,
    final_output_video,
    start_sec=None,
    end_sec=None,
    *,
    source_analysis: SourceAnalysis,
    source_media=None,
    metrics: JobVideoMetrics | None = None,
    layout_format: str = "standard",
    facecam_size: str = "medium",
    webcam_region: dict | None = None,
    gameplay_region: dict | None = None,
    gameplay_zoom: float = 1.0,
    streamer_tracking_enabled: bool = False,
):
    """
    Core logic to convert horizontal video to vertical using scene detection and Active Speaker Tracking (MediaPipe).
    """
    script_start_time = time.time()
    layout_options = normalize_clip_layout(layout_format, facecam_size)
    normalized_webcam_region = None
    normalized_gameplay_region = None
    normalized_gameplay_zoom = 1.0
    if layout_options.layout_format == STREAMER_STACK_LAYOUT:
        if webcam_region is None:
            raise ValueError("webcam_region is required for streamer_stack rendering")
        if gameplay_region is None:
            raise ValueError("gameplay_region is required for streamer_stack rendering")
        normalized_webcam_region = normalize_webcam_region(webcam_region)
        normalized_gameplay_region = normalize_gameplay_region(gameplay_region)
        normalized_gameplay_zoom = normalize_gameplay_zoom(gameplay_zoom)
    
    # Define temporary file paths based on the output name
    base_name = os.path.splitext(final_output_video)[0]
    temp_video_output = f"{base_name}_temp_video.mp4"
    temp_audio_output = f"{base_name}_temp_audio.m4a"
    
    # Clean up previous temp files if they exist
    if os.path.exists(temp_video_output): os.remove(temp_video_output)
    if os.path.exists(temp_audio_output): os.remove(temp_audio_output)
    if os.path.exists(final_output_video): os.remove(final_output_video)

    print(f"🎬 Processing clip: {input_video}")
    source_fps = float(source_analysis.source_fps)
    fps = min(source_fps, 60.0)
    frame_stride = max(1, round(source_fps / fps))

    total_frames = int(source_analysis.total_frames)
    if source_media is None:
        source_media = probe_media(input_video)
    source_has_audio = source_media.audio is not None
    trim = resolve_clip_frame_range(
        start_sec,
        end_sec,
        source_fps=source_fps,
        total_frames=total_frames,
    )
    print(
        f"   ⏱️ Source trim: frames {trim.start_frame}-{trim.end_frame} "
        f"({trim.start_sec:.6f}s-{trim.end_sec:.6f}s)"
    )
    
    scenes = source_analysis.scene_boundaries
    scene_boundaries = source_analysis.scene_boundaries
    scene_strategies = source_analysis.scene_strategies

    print(f"   ✅ Found {len(scenes)} scenes.")

    print("\n   🧠 Step 2: Preparing Active Tracking...")
    original_width = int(source_analysis.width)
    original_height = int(source_analysis.height)
    master_spec = choose_master_spec(source_media, strategy="crop")
    OUTPUT_WIDTH = master_spec.width
    OUTPUT_HEIGHT = master_spec.height

    # Initialize Cameraman
    cameraman = (
        SmoothedCameraman(OUTPUT_WIDTH, OUTPUT_HEIGHT, original_width, original_height)
        if layout_options.layout_format != STREAMER_STACK_LAYOUT
        else None
    )
    streamer_gameplay_focus = None
    
    print("\n   ✂️ Step 2: Processing video frames...")
    
    command = [
        'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
        '-s', f'{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}', '-pix_fmt', 'bgr24',
        '-r', str(fps), '-i', '-', '-vf', master_video_filter(),
        *master_video_encode_args(include_audio=False, fps=fps),
        '-an', temp_video_output
    ]

    cap = FFmpegVideoStream(
        input_video,
        width=source_analysis.width,
        height=source_analysis.height,
        fps=source_fps,
        total_frames=total_frames,
        start_frame=trim.start_frame,
        end_frame=trim.end_frame,
    )
    if metrics is not None:
        metrics.increment("clips_started")
    processed_frames = 0
    try:
        person_detection_interval_seconds = max(
            1.0,
            float(os.environ.get("OPENSHORTS_YOLO_INTERVAL_SECONDS", "1.5")),
        )
    except (TypeError, ValueError):
        person_detection_interval_seconds = 1.5
    last_yolo_frame = -1
    current_scene_index = 0

    while (
        current_scene_index + 1 < len(scene_boundaries)
        and trim.start_frame >= scene_boundaries[current_scene_index][1]
    ):
        current_scene_index += 1

    # Global tracker for single-person shots
    speaker_tracker = (
        SpeakerTracker(cooldown_frames=30)
        if layout_options.layout_format != STREAMER_STACK_LAYOUT or streamer_tracking_enabled
        else None
    )

    ffmpeg_process = None
    stderr_output = ""
    encoder_finalized = False
    frame_processing_started = time.monotonic()
    try:
        ffmpeg_process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        with tqdm(total=trim.frame_count, desc="   Processing", file=sys.stdout) as pbar:
            while cap.frame_number < trim.end_frame:
                frame = cap.read()
                if frame is False:
                    break
                frame_number = cap.frame_number - 1
                if metrics is not None:
                    metrics.increment("decoded_frames")

                if (frame_number - trim.start_frame) % frame_stride != 0:
                    pbar.update(1)
                    continue

                # Update Scene Index
                if current_scene_index < len(scene_boundaries):
                    start_f, end_f = scene_boundaries[current_scene_index]
                    while frame_number >= end_f and current_scene_index < len(scene_boundaries) - 1:
                        current_scene_index += 1
                        start_f, end_f = scene_boundaries[current_scene_index]
                
                # Determine Strategy for current frame based on scene
                current_strategy = scene_strategies[current_scene_index] if current_scene_index < len(scene_strategies) else 'TRACK'
                is_scene_start = (
                    frame_number == trim.start_frame
                    or frame_number == scene_boundaries[current_scene_index][0]
                )
                
                # Apply Strategy
                if layout_options.layout_format == STREAMER_STACK_LAYOUT:
                    if streamer_tracking_enabled and (frame_number % 2 == 0 or is_scene_start):
                        candidates = filter_candidates_outside_webcam_region(
                            filter_candidates_inside_gameplay_region(
                                detect_face_candidates(frame),
                                normalized_gameplay_region,
                                original_width,
                                original_height,
                            ),
                            normalized_webcam_region,
                            original_width,
                            original_height,
                        )
                        target_box = speaker_tracker.get_target(candidates, frame_number, original_width)
                        if target_box is None and should_run_person_detection(
                            frame_number,
                            scene_boundaries[current_scene_index][0],
                            last_yolo_frame,
                            source_fps,
                            person_detection_interval_seconds,
                        ):
                            fallback_box = detect_person_yolo(frame)
                            last_yolo_frame = frame_number
                            fallback_candidates = filter_candidates_inside_gameplay_region(
                                [{"box": fallback_box}] if fallback_box else [],
                                normalized_gameplay_region,
                                original_width,
                                original_height,
                            )
                            if fallback_candidates and filter_candidates_outside_webcam_region(
                                fallback_candidates,
                                normalized_webcam_region,
                                original_width,
                                original_height,
                            ):
                                target_box = fallback_box
                        if target_box:
                            x, y, width, height = target_box
                            streamer_gameplay_focus = (
                                (x + width / 2) / max(original_width, 1),
                                (y + height / 2) / max(original_height, 1),
                            )
                    output_frame = compose_streamer_stack_frame(
                        frame,
                        OUTPUT_WIDTH,
                        OUTPUT_HEIGHT,
                        facecam_size=layout_options.facecam_size,
                        webcam_region=normalized_webcam_region,
                        gameplay_region=normalized_gameplay_region,
                        gameplay_focus=streamer_gameplay_focus,
                        gameplay_zoom=normalized_gameplay_zoom,
                    )
                elif current_strategy == 'GENERAL':
                    # "Plano General" -> Blur Background + Fit Width
                    output_frame = create_general_frame(frame, OUTPUT_WIDTH, OUTPUT_HEIGHT)

                    # Reset cameraman/tracker so they don't drift while inactive
                    cameraman.current_center_x = original_width / 2
                    cameraman.target_center_x = original_width / 2

                else:
                    # "Single Speaker" -> Track & Crop

                    # Face tracking remains frequent; gate the expensive YOLO fallback.
                    if frame_number % 2 == 0 or is_scene_start:
                        candidates = detect_face_candidates(frame)
                        target_box = speaker_tracker.get_target(candidates, frame_number, original_width)
                        if target_box:
                            cameraman.update_target(target_box)
                        elif should_run_person_detection(
                            frame_number,
                            scene_boundaries[current_scene_index][0],
                            last_yolo_frame,
                            source_fps,
                            person_detection_interval_seconds,
                        ):
                            person_box = detect_person_yolo(frame)
                            last_yolo_frame = frame_number
                            if person_box:
                                cameraman.update_target(person_box)

                    # Snap camera on scene change to avoid panning from previous scene position
                    x1, y1, x2, y2 = cameraman.get_crop_box(force_snap=is_scene_start)

                    # Crop
                    if y2 > y1 and x2 > x1:
                        cropped = frame[y1:y2, x1:x2]
                        output_frame = cv2.resize(cropped, (OUTPUT_WIDTH, OUTPUT_HEIGHT))
                    else:
                        output_frame = cv2.resize(frame, (OUTPUT_WIDTH, OUTPUT_HEIGHT))

                ffmpeg_process.stdin.write(output_frame.tobytes())
                processed_frames += 1
                if metrics is not None:
                    metrics.increment("output_frames")
                pbar.update(1)
        ffmpeg_process.stdin.close()
        stderr_output = ffmpeg_process.stderr.read().decode()
        ffmpeg_process.wait()
        encoder_finalized = True
    finally:
        cap.close()
        if ffmpeg_process is not None and not encoder_finalized:
            if ffmpeg_process.poll() is None:
                if ffmpeg_process.stdin is not None:
                    try:
                        ffmpeg_process.stdin.close()
                    except OSError:
                        pass
                ffmpeg_process.terminate()
                try:
                    ffmpeg_process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    ffmpeg_process.kill()
                    ffmpeg_process.wait()
            if ffmpeg_process.stderr is not None:
                ffmpeg_process.stderr.close()

    if metrics is not None:
        metrics.add_duration(
            "frame_processing", time.monotonic() - frame_processing_started
        )
    ffmpeg_process.stderr.close()

    if ffmpeg_process.returncode != 0:
        print("\n   ❌ FFmpeg frame processing failed.")
        print("   Stderr:", stderr_output)
        return False
    if processed_frames == 0:
        print("\n   ❌ No decodable video frames were produced.")
        return False

    print("\n   🔊 Step 5: Extracting audio...")
    audio_extract_command = build_audio_extract_command(
        input_video, temp_audio_output, trim
    )
    audio_started = time.monotonic()
    try:
        subprocess.run(audio_extract_command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError:
        if source_has_audio:
            print("\n   ❌ Required audio extraction failed.")
        else:
            print("\n   ℹ️ Source has no audio; proceeding without audio.")
        pass
    if metrics is not None:
        metrics.add_duration("audio", time.monotonic() - audio_started)

    print("\n   ✨ Step 6: Merging...")
    if os.path.exists(temp_audio_output):
        merge_command = [
            'ffmpeg', '-y', '-i', temp_video_output, '-i', temp_audio_output,
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy', '-c:a', 'copy',
            '-movflags', '+faststart', final_output_video
        ]
    else:
         merge_command = [
            'ffmpeg', '-y', '-i', temp_video_output,
            '-map', '0:v:0', '-c:v', 'copy', '-movflags', '+faststart', final_output_video
        ]
        
    merge_started = time.monotonic()
    try:
        subprocess.run(merge_command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        validation_started = time.monotonic()
        validate_clip_output(
            final_output_video,
            expected_width=OUTPUT_WIDTH,
            expected_height=OUTPUT_HEIGHT,
            expected_fps=fps,
            source_has_audio=source_has_audio,
        )
        if metrics is not None:
            metrics.add_duration("validation", time.monotonic() - validation_started)
            metrics.increment("validated_clips")
            metrics.increment("output_bytes", os.path.getsize(final_output_video))
        print(f"   ✅ Clip saved to {final_output_video}")
    except (subprocess.CalledProcessError, ValueError) as e:
        print("\n   ❌ Final merge failed.")
        if isinstance(e, subprocess.CalledProcessError):
            print("   Stderr:", e.stderr.decode())
        else:
            print("   Output validation:", e)
        if os.path.exists(final_output_video):
            os.remove(final_output_video)
        return False

    if metrics is not None:
        metrics.add_duration("encode_and_merge", time.monotonic() - merge_started)

    # Clean up temp files
    if os.path.exists(temp_video_output): os.remove(temp_video_output)
    if os.path.exists(temp_audio_output): os.remove(temp_audio_output)
    
    return True


def _prepare_manifest_source(
    input_video: str,
    output_dir: str,
    source_object: dict | None = None,
) -> tuple[str, dict, object]:
    """Prepare local or temporary remote source metadata without duplicating remote files."""
    os.makedirs(output_dir, exist_ok=True)
    source_path = os.path.abspath(input_video)
    if source_object:
        media = probe_media(source_path)
        asset = register_remote_asset(Path(source_path), media, source_object)
        return source_path, asset, media

    job_root = os.path.abspath(output_dir)
    try:
        inside_job = os.path.commonpath([source_path, job_root]) == job_root
    except ValueError:
        inside_job = False
    if not inside_job:
        source_name = os.path.basename(source_path)
        destination = os.path.join(output_dir, f"source_{source_name}")
        if os.path.abspath(destination) != source_path:
            shutil.copy2(source_path, destination)
        source_path = destination
    media = probe_media(source_path)
    asset = register_asset(Path(source_path), Path(output_dir), media)
    return source_path, asset, media


def _build_clip_subtitle_track(
    transcript: dict,
    clip_start: float,
    clip_end: float,
    srt_filename: str,
) -> dict | None:
    cues = build_subtitle_segments(transcript or {}, clip_start, clip_end)
    if not cues:
        return None
    normalized_cues = [
        {
            "text": cue["text"],
            "startMs": round(float(cue["start"]) * 1000),
            "endMs": round(float(cue["end"]) * 1000),
        }
        for cue in cues
    ]
    return {
        "id": "original",
        "language": transcript.get("language", "und"),
        "label": "Original",
        "origin": "original",
        "cues": normalized_cues,
        "captions": normalized_cues,
        "srt_filename": srt_filename,
    }


def _burn_clip_subtitles(
    video_path: str,
    output_dir: str,
    transcript: dict,
    clip_start: float,
    clip_end: float,
    subtitle_track: dict | None,
) -> bool:
    if subtitle_track is None:
        return False

    srt_path = os.path.join(output_dir, subtitle_track["srt_filename"])
    if not generate_srt(transcript or {}, clip_start, clip_end, srt_path):
        return False

    base, extension = os.path.splitext(video_path)
    subtitled_path = f"{base}_with_subtitles{extension}"
    if os.path.exists(subtitled_path):
        os.remove(subtitled_path)
    burn_subtitles(video_path, srt_path, subtitled_path)
    if not os.path.isfile(subtitled_path):
        raise RuntimeError("Subtitle rendering completed without producing a video")
    os.replace(subtitled_path, video_path)
    return True


def _write_clip_manifest(
    output_dir: str,
    video_title: str,
    clip_index: int,
    clip: dict,
    source_asset: dict,
    source_media,
    transcript: dict,
    source_object: dict | None = None,
    layout_format: str = "standard",
    facecam_size: str = "medium",
    webcam_region: dict | None = None,
    gameplay_region: dict | None = None,
    gameplay_zoom: float = 1.0,
    streamer_tracking_enabled: bool = False,
    subtitle_track: dict | None = None,
) -> str:
    width = source_media.display_width
    height = source_media.display_height
    crop_width = min(1.0, (height * (9 / 16)) / max(width, 1))
    crop = CropRect((1.0 - crop_width) / 2.0, 0.0, crop_width, 1.0)
    track = CropTrack((CropScene(
        float(clip["start"]), float(clip["end"]), "TRACK",
        (CropKeyframe(float(clip["start"]), crop), CropKeyframe(float(clip["end"]), crop)),
    ),))
    layout_options = normalize_clip_layout(layout_format, facecam_size)
    normalized_webcam_region = (
        normalize_webcam_region(webcam_region) if webcam_region is not None else None
    )
    normalized_gameplay_region = (
        normalize_gameplay_region(gameplay_region) if gameplay_region is not None else None
    )
    normalized_gameplay_zoom = normalize_gameplay_zoom(gameplay_zoom)
    layout_manifest = {
        "format": layout_options.layout_format,
        "facecam_size": layout_options.facecam_size,
    }
    if normalized_webcam_region is not None:
        layout_manifest["webcam_region"] = normalized_webcam_region
    if normalized_gameplay_region is not None:
        layout_manifest["gameplay_region"] = normalized_gameplay_region
    if layout_options.layout_format == STREAMER_STACK_LAYOUT:
        layout_manifest["gameplay_zoom"] = normalized_gameplay_zoom
    if layout_options.layout_format == STREAMER_STACK_LAYOUT:
        layout_manifest["streamer_tracking_enabled"] = bool(streamer_tracking_enabled)
    manifest = {
        "schema_version": 1,
        "project_id": os.path.basename(output_dir),
        "workflow": "long_video",
        "assets": {source_asset["asset_id"]: source_asset},
        "source_object": source_object,
        "timeline": {
            "source_asset_id": source_asset["asset_id"],
            "trim": {"start_sec": float(clip["start"]), "end_sec": float(clip["end"])},
            "crop_track": track.to_dict(),
            "transcript": transcript,
        },
        "subtitle_tracks": [subtitle_track] if subtitle_track else [],
        "active_subtitle_track_id": "original" if subtitle_track else None,
        "layers": {
            "subtitles": subtitle_track,
            "hook": None,
            "effects": None,
            "audio": None,
            "layout": {
                **layout_manifest,
            },
        },
        "export_policy": {
            "aspect_ratio": "9:16",
            "max_fps": 60,
            "layout_format": layout_options.layout_format,
            "facecam_size": layout_options.facecam_size,
        },
        "master": None,
    }
    if normalized_webcam_region is not None:
        manifest["export_policy"]["webcam_region"] = normalized_webcam_region
    if normalized_gameplay_region is not None:
        manifest["export_policy"]["gameplay_region"] = normalized_gameplay_region
    if layout_options.layout_format == STREAMER_STACK_LAYOUT:
        manifest["export_policy"]["gameplay_zoom"] = normalized_gameplay_zoom
        manifest["export_policy"]["streamer_tracking_enabled"] = bool(streamer_tracking_enabled)
    manifest_path = os.path.join(output_dir, "manifests", f"clip_{clip_index}.json")
    save_manifest_atomic(Path(manifest_path), manifest)
    return os.path.relpath(manifest_path, output_dir).replace(os.sep, "/")


def persist_discovered_clip_plan(
    clips_data: dict,
    *,
    output_dir: str,
    video_title: str,
    source_path: str,
    source_asset: dict,
    source_media,
    transcript: dict,
    source_object: dict | None = None,
    layout_format: str = "standard",
    facecam_size: str = "medium",
) -> tuple[dict, str]:
    """Persist candidate clips without paying for scene/face analysis or rendering."""
    layout_options = normalize_clip_layout(layout_format, facecam_size)
    master_spec = choose_master_spec(source_media, strategy="crop")
    output_root = Path(output_dir).resolve()
    source_path_value = os.path.relpath(os.path.abspath(source_path), output_root).replace(os.sep, "/")

    clips_data["transcript"] = transcript
    clips_data["source_asset"] = source_asset
    clips_data["source_path"] = source_path_value
    clips_data["video_title"] = video_title
    if source_object:
        clips_data["source_object"] = dict(source_object)

    for clip in clips_data.get("shorts", []):
        clip["render_status"] = "found"
        clip["render_job_id"] = None
        clip["source_video_filename"] = source_asset.get("relative_path", "")
        clip["source_video_url"] = (
            f"/videos/{os.path.basename(output_dir)}/{source_asset.get('relative_path', '')}"
            if source_asset.get("relative_path")
            else ""
        )
        clip["output_width"] = master_spec.width
        clip["output_height"] = master_spec.height
        clip["output_fps"] = master_spec.fps
        clip["source_has_audio"] = source_media.audio is not None
        clip["layout_format"] = layout_options.layout_format
        clip["facecam_size"] = layout_options.facecam_size
        if layout_options.layout_format == STREAMER_STACK_LAYOUT:
            clip["streamer_tracking_enabled"] = False
            clip["gameplay_zoom"] = 1.0

    metadata_path = Path(output_dir) / f"{video_title}_metadata.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = metadata_path.with_name(f".{metadata_path.name}.tmp")
    temporary_path.write_text(json.dumps(clips_data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary_path, metadata_path)
    return clips_data, str(metadata_path)


def _clip_metadata_path(output_dir: str) -> Path:
    metadata_files = sorted(Path(output_dir).glob("*_metadata.json"))
    if not metadata_files:
        raise FileNotFoundError("Clip metadata not found")
    return metadata_files[0]


def _write_clip_metadata(metadata_path: Path, metadata: dict) -> None:
    temporary_path = metadata_path.with_name(f".{metadata_path.name}.tmp")
    temporary_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary_path, metadata_path)


def render_deferred_clip(
    *,
    input_video: str,
    output_dir: str,
    clip_index: int,
    metrics: JobVideoMetrics | None = None,
) -> dict:
    """Render one persisted candidate and update only that candidate's metadata."""
    metadata_path = _clip_metadata_path(output_dir)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    clips = metadata.get("shorts") or []
    if clip_index < 0 or clip_index >= len(clips):
        raise IndexError("Clip not found")
    clip = clips[clip_index]
    clip["render_status"] = "analyzing"
    clip.pop("render_error", None)
    _write_clip_metadata(metadata_path, metadata)
    try:
        source_analysis = build_clip_source_analysis_for_job(
            input_video,
            output_dir,
            clip_index=clip_index,
            start_sec=float(clip["start"]),
            end_sec=float(clip["end"]),
            metrics=metrics,
        )
        clip["render_status"] = "rendering"
        _write_clip_metadata(metadata_path, metadata)
        source_asset = metadata.get("source_asset") or {}
        source_media = probe_media(input_video)
        rendered = render_clip_plan(
            input_video=input_video,
            output_dir=output_dir,
            video_title=str(metadata.get("video_title") or Path(metadata_path).stem.replace("_metadata", "")),
            clips=[clip],
            clip_indices=[clip_index],
            source_analysis=source_analysis,
            transcript=metadata.get("transcript") or {},
            source_asset=source_asset,
            source_media=source_media,
            source_object=metadata.get("source_object"),
            metrics=metrics,
            layout_format=clip.get("layout_format", "standard"),
            facecam_size=clip.get("facecam_size", "medium"),
            webcam_region=clip.get("webcam_region"),
            gameplay_region=clip.get("gameplay_region"),
            gameplay_zoom=clip.get("gameplay_zoom", 1.0),
            streamer_tracking_enabled=bool(clip.get("streamer_tracking_enabled", False)),
        )
        if not rendered:
            raise RuntimeError("Clip rendering produced no artifact")
        clip["render_status"] = "ready"
        clip.pop("render_error", None)
        _write_clip_metadata(metadata_path, metadata)
        return clip
    except Exception as error:
        clip["render_status"] = "failed"
        clip["render_error"] = str(error)
        _write_clip_metadata(metadata_path, metadata)
        raise


def render_clip_plan(
    *,
    input_video: str,
    output_dir: str,
    video_title: str,
    clips: list[dict],
    source_analysis: SourceAnalysis,
    transcript: dict,
    source_asset: dict,
    source_media,
    source_object: dict | None = None,
    metrics: JobVideoMetrics | None = None,
    layout_format: str = "standard",
    facecam_size: str = "medium",
    webcam_region: dict | None = None,
    gameplay_region: dict | None = None,
    gameplay_zoom: float = 1.0,
    streamer_tracking_enabled: bool = False,
    clip_indices: list[int] | None = None,
    include_subtitles: bool = False,
) -> list[dict]:
    """Render a clip plan; subtitles are opt-in and disabled for plain Render."""
    layout_options = normalize_clip_layout(layout_format, facecam_size)
    rendered_clips = []
    source_video_filename = source_asset.get("relative_path", "")
    source_video_url = (
        f"/videos/{os.path.basename(output_dir)}/{source_video_filename}"
        if source_video_filename
        else ""
    )
    master_spec = choose_master_spec(source_media, strategy="crop")

    for position, clip in enumerate(clips):
        index = (clip_indices[position] + 1) if clip_indices is not None else (position + 1)
        start = clip["start"]
        end = clip["end"]
        clip_filename = f"{video_title}_clip_{index}.mp4"
        clip_final_path = os.path.join(output_dir, clip_filename)
        clip_webcam_region = clip.get("webcam_region", webcam_region)
        if clip_webcam_region is not None:
            clip_webcam_region = normalize_webcam_region(clip_webcam_region)
        clip_gameplay_region = clip.get("gameplay_region", gameplay_region)
        if clip_gameplay_region is not None:
            clip_gameplay_region = normalize_gameplay_region(clip_gameplay_region)
        clip_gameplay_zoom = normalize_gameplay_zoom(clip.get("gameplay_zoom", gameplay_zoom))
        clip_tracking_enabled = bool(
            clip.get("streamer_tracking_enabled", streamer_tracking_enabled)
        )
        if layout_options.layout_format == STREAMER_STACK_LAYOUT and clip_webcam_region is None:
            raise ValueError("webcam_region is required for streamer_stack rendering")
        if layout_options.layout_format == STREAMER_STACK_LAYOUT and clip_gameplay_region is None:
            raise ValueError("gameplay_region is required for streamer_stack rendering")
        if clip_webcam_region is not None:
            clip["webcam_region"] = clip_webcam_region
        if clip_gameplay_region is not None:
            clip["gameplay_region"] = clip_gameplay_region
        if layout_options.layout_format == STREAMER_STACK_LAYOUT:
            clip["streamer_tracking_enabled"] = clip_tracking_enabled
            clip["gameplay_zoom"] = clip_gameplay_zoom
        subtitle_track = (
            _build_clip_subtitle_track(
                transcript,
                float(start),
                float(end),
                f"{video_title}_clip_{index}.srt",
            )
            if include_subtitles
            else None
        )

        manifest_path = _write_clip_manifest(
            output_dir,
            video_title,
            index,
            clip,
            source_asset,
            source_media,
            transcript,
            source_object,
            layout_options.layout_format,
            layout_options.facecam_size,
            webcam_region=clip_webcam_region,
            gameplay_region=clip_gameplay_region,
            gameplay_zoom=clip_gameplay_zoom,
            streamer_tracking_enabled=clip_tracking_enabled,
            subtitle_track=subtitle_track,
        )
        clip["manifest_path"] = manifest_path
        clip["source_video_filename"] = source_video_filename
        clip["source_video_url"] = source_video_url
        if source_object:
            clip["source_object"] = dict(source_object)
        clip["video_filename"] = clip_filename
        clip["output_width"] = master_spec.width
        clip["output_height"] = master_spec.height
        clip["output_fps"] = master_spec.fps
        clip["source_has_audio"] = source_media.audio is not None
        clip["layout_format"] = layout_options.layout_format
        clip["facecam_size"] = layout_options.facecam_size

        print(f"\nProcessing Clip {index}: {start}s - {end}s")
        print(f"   Title: {clip.get('video_title_for_youtube_short', 'No Title')}")
        success = process_video_to_vertical(
            input_video,
            clip_final_path,
            start_sec=start,
            end_sec=end,
            source_analysis=source_analysis,
            source_media=source_media,
            metrics=metrics,
            layout_format=layout_options.layout_format,
            facecam_size=layout_options.facecam_size,
            webcam_region=clip_webcam_region,
            gameplay_region=clip_gameplay_region,
            gameplay_zoom=clip_gameplay_zoom,
            streamer_tracking_enabled=clip_tracking_enabled,
        )
        if success:
            if subtitle_track is not None:
                _burn_clip_subtitles(
                    clip_final_path,
                    output_dir,
                    transcript,
                    start,
                    end,
                    subtitle_track,
                )
                clip["subtitle_filename"] = subtitle_track["srt_filename"]
                clip["subtitle_url"] = (
                    f"/videos/{os.path.basename(output_dir)}/{subtitle_track['srt_filename']}"
                )
                clip["subtitles"] = subtitle_track
            rendered_clips.append(clip)

    return rendered_clips


def transcribe_video(video_path, *, duration_seconds=None, emit_log=None, headers=None):
    if duration_seconds is None:
        duration_seconds = probe_media(video_path).duration_seconds
    return transcribe_video_with_config(
        video_path,
        duration_seconds,
        emit_log,
        headers=headers,
    )

def _clip_text_snippet(text, fallback="Auto-generated fallback clip"):
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return fallback
    words = cleaned.split()
    snippet = " ".join(words[:14]).strip()
    return snippet if snippet else fallback


def _build_fallback_clip_plan(
    transcript_result,
    video_duration,
    target_clips=6,
    *,
    min_duration=15.0,
    target_duration=None,
):
    """
    Build a conservative clip plan when the AI returns no usable shorts.
    This keeps the pipeline moving instead of falling back to the entire video.
    """
    segments = []
    for segment in transcript_result.get("segments", []):
        start = segment.get("start")
        end = segment.get("end")
        if start is None or end is None:
            continue
        try:
            start_f = float(start)
            end_f = float(end)
        except (TypeError, ValueError):
            continue
        if end_f <= start_f:
            continue
        segments.append({
            "start": start_f,
            "end": end_f,
            "text": (segment.get("text") or "").strip(),
        })

    language = transcript_result.get("language", "en")
    total_duration = max(float(video_duration or 0), 0.0)
    clip_limit = max(1, min(int(target_clips or 1), 15))
    min_duration = max(float(min_duration or 0.0), 0.0)
    target_duration = float(target_duration or 0.0) if target_duration else None

    def make_short(start, end, text, index):
        snippet = _clip_text_snippet(text)
        title = snippet[:100].rstrip()
        if not title:
            title = f"Fallback Clip {index + 1}"
        hook = snippet[:48].upper()
        if not hook:
            hook = "WATCH THIS"
        description = f"Fallback clip generated from the transcript. {snippet}"
        return {
            "start": round(max(0.0, float(start)), 3),
            "end": round(min(total_duration, float(end)), 3),
            "video_description_for_tiktok": description,
            "video_description_for_instagram": description,
            "video_title_for_youtube_short": title,
            "viral_hook_text": hook[:50],
            "language": language,
        }

    shorts = []
    if segments:
        target_window = total_duration / clip_limit if clip_limit else total_duration
        lower_bound = target_duration or min_duration or 15.0
        target_window = min(max(target_window, lower_bound), 45.0)

        idx = 0
        while idx < len(segments) and len(shorts) < clip_limit:
            start_idx = idx
            start = segments[start_idx]["start"]
            end = segments[start_idx]["end"]

            # Accumulate adjacent transcript segments until the window is usable.
            while (
                idx + 1 < len(segments)
                and (end - start) < target_window
            ):
                idx += 1
                end = segments[idx]["end"]

            # Ensure the clip is at least 15 seconds long when possible.
            if (end - start) < min_duration and idx + 1 < len(segments):
                idx += 1
                end = segments[idx]["end"]

            start = max(0.0, start - 0.25)
            end = min(total_duration or end, end + 0.25)

            if end - start < min_duration and total_duration >= min_duration:
                mid = (start + end) / 2.0
                start = max(0.0, mid - (min_duration / 2.0))
                end = min(total_duration, start + min_duration)

            if end > start:
                clip_text = " ".join(
                    part["text"] for part in segments[start_idx:idx + 1] if part["text"]
                )
                shorts.append(make_short(start, end, clip_text, len(shorts)))

            idx += 1

    if not shorts:
        fallback_window = target_duration or 45.0
        end = min(total_duration, fallback_window if total_duration >= fallback_window else total_duration)
        if end <= 0:
            end = min_duration
        shorts.append(make_short(0.0, end, transcript_result.get("text", ""), 0))

    return {
        "shorts": shorts,
        "fallback_reason": "AI returned no usable clip plan; generated transcript-based fallback clips.",
    }


def _stretch_clip_window(start, end, total_duration, *, min_duration=15.0, target_duration=None):
    """
    Expand a clip window around its center so it feels less cut off.

    This is especially useful for local models, which often return tight,
    high-signal timestamps that are technically valid but too short for Shorts.
    """
    total_duration = max(float(total_duration or 0), 0.0)
    start = max(0.0, float(start or 0.0))
    end = max(start, float(end or start))

    if total_duration > 0:
        end = min(end, total_duration)

    current = max(end - start, 0.0)
    desired = float(target_duration or min_duration or current or 0.0)
    if current >= desired or desired <= 0:
        return round(start, 3), round(end, 3)

    center = (start + end) / 2.0
    half = desired / 2.0
    new_start = center - half
    new_end = center + half

    if new_start < 0.0:
        new_end += abs(new_start)
        new_start = 0.0
    if total_duration > 0 and new_end > total_duration:
        shift = new_end - total_duration
        new_start = max(0.0, new_start - shift)
        new_end = total_duration

    if total_duration > 0 and new_end - new_start > total_duration:
        new_start = 0.0
        new_end = total_duration

    if new_end <= new_start:
        return round(start, 3), round(end, 3)

    return round(new_start, 3), round(new_end, 3)


def _clip_analysis_chunks(transcript_result, video_duration=0.0):
    """Build compact absolute-time transcript chunks for clip analysis prompts."""
    compact_segments = []
    raw_segments = transcript_result.get("segments", []) or []

    def append_text_parts(start, end, text):
        remaining = str(text or "").strip()
        while remaining:
            low, high = 1, len(remaining)
            best = 1
            while low <= high:
                midpoint = (low + high) // 2
                candidate = {"start": start, "end": end, "text": remaining[:midpoint]}
                if len(json.dumps([candidate], ensure_ascii=False)) <= CLIP_ANALYSIS_MAX_CHUNK_CHARS:
                    best = midpoint
                    low = midpoint + 1
                else:
                    high = midpoint - 1
            compact_segments.append({"start": start, "end": end, "text": remaining[:best]})
            remaining = remaining[best:].lstrip()

    for raw_segment in raw_segments:
        text = re.sub(r"\s+", " ", str(raw_segment.get("text") or "").strip())
        if not text:
            continue
        try:
            start = round(float(raw_segment.get("start")), 3)
            end = round(float(raw_segment.get("end")), 3)
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        append_text_parts(start, end, text)

    if not compact_segments:
        text = re.sub(r"\s+", " ", str(transcript_result.get("text") or "").strip())
        if text:
            append_text_parts(0.0, round(max(float(video_duration or 0.0), 0.0), 3), text)

    chunks = []
    current = []
    for segment in compact_segments:
        if current and len(json.dumps(current + [segment], ensure_ascii=False)) > CLIP_ANALYSIS_MAX_CHUNK_CHARS:
            chunks.append(current)
            current = []
        current.append(segment)
    if current:
        chunks.append(current)
    return chunks or [[]]


def _snap_clip_boundaries(short, transcript_result, video_duration):
    """Snap AI timestamps outward to nearby local word boundaries."""
    if not isinstance(short, dict):
        return short
    try:
        start = float(short.get("start"))
        end = float(short.get("end"))
    except (TypeError, ValueError):
        return short

    total_duration = max(float(video_duration or 0.0), 0.0)
    start = max(0.0, start)
    end = min(total_duration, end) if total_duration else max(0.0, end)
    if end <= start:
        return short

    starts = []
    ends = []
    for segment in transcript_result.get("segments", []) or []:
        for word in segment.get("words", []) or []:
            try:
                word_start = float(word.get("start", word.get("s")))
                word_end = float(word.get("end", word.get("e")))
            except (TypeError, ValueError):
                continue
            if word_end > word_start:
                starts.append(word_start)
                ends.append(word_end)

    if starts:
        starts.sort()
        end_starts = [value for value in starts if value <= start]
        start = max(end_starts) if end_starts else starts[0]
    if ends:
        ends.sort()
        following_ends = [value for value in ends if value >= end]
        end = min(following_ends) if following_ends else ends[-1]

    if total_duration:
        start = min(start, total_duration)
        end = min(end, total_duration)
    if end <= start:
        return short

    snapped = dict(short)
    snapped["start"] = round(start, 3)
    snapped["end"] = round(end, 3)
    return snapped


def get_viral_clips(transcript_result, video_duration, target_clips=6, source_context=None):
    ai_config = load_ai_config()
    print(f"🤖  Analyzing with {ai_config.normalized_provider()}...")

    if ai_config.is_gemini() and not ai_config.api_key:
        print("❌ Error: GEMINI_API_KEY not found in environment variables.")
        return None

    is_lmstudio = ai_config.is_lmstudio()
    local_min_duration = 24.0 if is_lmstudio else 15.0
    local_target_duration = 32.0 if is_lmstudio else None

    try:
        model_name = ai_config.analyze_model or ai_config.text_model or ("gemini-2.5-flash" if ai_config.is_gemini() else "")
        chunks = _clip_analysis_chunks(transcript_result, video_duration)
        per_chunk_target = max(1, min(15, (int(target_clips or 1) + len(chunks) - 1) // len(chunks)))
        result_json = {}
        all_shorts = []
        source_context_json = (
            json.dumps(normalize_source_context(source_context), ensure_ascii=False)
            if source_context
            else "No original source context was provided."
        )

        for chunk in chunks:
            prompt = GEMINI_PROMPT_TEMPLATE.format(
                video_duration=video_duration,
                target_clips=per_chunk_target,
                source_context=source_context_json,
                transcript_segments=json.dumps(chunk, ensure_ascii=False),
            )
            if len(prompt) > CLIP_ANALYSIS_MAX_PROMPT_CHARS:
                raise ValueError("Clip analysis prompt exceeds the configured size limit")

            response = chat_json(
                ai_config,
                prompt,
                model=model_name,
                reasoning_effort=ai_config.analyze_reasoning_effort,
            )
            if not isinstance(response, dict):
                continue
            result_json = dict(response)

            # Some models use alternate keys. Normalize those here before fallback.
            if "shorts" not in result_json or not isinstance(result_json.get("shorts"), list):
                for alt_key in ("clips", "moments", "clip_plan", "viral_clips"):
                    alt_value = result_json.get(alt_key)
                    if isinstance(alt_value, list) and alt_value:
                        result_json["shorts"] = alt_value
                        break

            shorts = result_json.get("shorts")
            if isinstance(shorts, list):
                all_shorts.extend(short for short in shorts if isinstance(short, dict))

        if not all_shorts:
            print("⚠️ AI returned no usable shorts. Using transcript-based fallback clips.")
            return _build_fallback_clip_plan(
                transcript_result,
                video_duration,
                target_clips,
                min_duration=local_min_duration,
                target_duration=local_target_duration,
            )

        clip_limit = max(1, min(int(target_clips or 1), 15))
        def score_value(clip):
            try:
                return float(clip.get("score", 0.0) or 0.0)
            except (TypeError, ValueError):
                return 0.0

        all_shorts.sort(key=score_value, reverse=True)
        adjusted_shorts = []
        for clip in all_shorts[:clip_limit]:
            if is_lmstudio:
                if not isinstance(clip, dict):
                    continue
                try:
                    clip_start = float(clip.get("start", 0.0))
                    clip_end = float(clip.get("end", 0.0))
                except (TypeError, ValueError):
                    continue
                clip_start, clip_end = _stretch_clip_window(
                    clip_start,
                    clip_end,
                    video_duration,
                    min_duration=local_min_duration,
                    target_duration=local_target_duration,
                )
                updated_clip = dict(clip)
                updated_clip["start"] = clip_start
                updated_clip["end"] = clip_end
                clip = updated_clip
            adjusted_shorts.append(_snap_clip_boundaries(clip, transcript_result, video_duration))

        result_json["shorts"] = adjusted_shorts

        if ai_config.is_gemini():
            result_json['cost_analysis'] = {
                "input_tokens": None,
                "output_tokens": None,
                "input_cost": None,
                "output_cost": None,
                "total_cost": None,
                "model": model_name,
            }

        return result_json
    except Exception as e:
        print(f"❌ AI Error: {e}")
        return _build_fallback_clip_plan(
            transcript_result,
            video_duration,
            target_clips,
            min_duration=local_min_duration,
            target_duration=local_target_duration,
        )

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="AutoCrop-Vertical with Viral Clip Detection.")
    
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument('-i', '--input', type=str, help="Path to the input video file.")
    input_group.add_argument('-u', '--url', type=str, help="YouTube URL to download and process.")
    input_group.add_argument('--direct-url', type=str, help="Direct HTTP(S) video URL to download and process.")
    parser.add_argument('--source-url', type=str, help="Original HTTPS YouTube or Twitch page used for metadata context only.")
    parser.add_argument('--source-object', type=str, help="JSON MinIO source object reference for provenance.")
    
    parser.add_argument('-o', '--output', type=str, help="Output directory or file (if processing whole video).")
    parser.add_argument('--keep-original', action='store_true', help="Keep the downloaded YouTube video.")
    parser.add_argument('--skip-analysis', action='store_true', help="Skip AI analysis and convert the whole video.")
    parser.add_argument('--defer-render', action='store_true', help="Find candidate clips without rendering them.")
    parser.add_argument('--render-clip', type=int, help="Render one zero-based candidate clip from persisted metadata.")
    parser.add_argument('--target-clips', type=int, default=6, help="Preferred number of viral clips to generate (3-15).")
    parser.add_argument(
        '--layout-format',
        choices=('standard', 'streamer_stack'),
        default='standard',
        help="Vertical clip layout format.",
    )
    parser.add_argument(
        '--facecam-size',
        choices=('small', 'medium', 'large'),
        default='medium',
        help="Streamer Stack facecam panel size.",
    )
    
    args = parser.parse_args()
    if args.defer_render and args.render_clip is not None:
        parser.error("--defer-render and --render-clip cannot be used together")
    if args.render_clip is not None and args.skip_analysis:
        parser.error("--render-clip cannot be combined with --skip-analysis")
    if args.render_clip is not None and args.render_clip < 0:
        parser.error("--render-clip must be non-negative")
    target_clips = min(max(3, args.target_clips), 15)
    try:
        source_object = parse_source_object_argument(args.source_object)
    except ValueError as exc:
        parser.error(f"invalid --source-object: {exc}")

    script_start_time = time.time()
    job_metrics = JobVideoMetrics()
    
    def _ensure_dir(path: str) -> str:
        """Create directory if missing and return the same path."""
        if path:
            os.makedirs(path, exist_ok=True)
        return path
    
    # 1. Get Input Video
    if args.url or args.direct_url:
        # For multi-clip runs, treat --output as an OUTPUT DIRECTORY (create it if needed).
        # For whole-video runs (--skip-analysis), --output can be a file path.
        if args.output and not args.skip_analysis:
            output_dir = _ensure_dir(args.output)
        else:
            # If output is a directory, use it; if it's a filename, use its directory; else default "."
            if args.output and os.path.isdir(args.output):
                output_dir = args.output
            elif args.output and not os.path.isdir(args.output):
                output_dir = os.path.dirname(args.output) or "."
            else:
                output_dir = "."
        
        if args.url:
            input_video, video_title = download_youtube_video(args.url, output_dir)
        else:
            input_video, video_title = download_direct_video(args.direct_url, output_dir)
    else:
        input_video = args.input
        video_title = os.path.splitext(os.path.basename(input_video))[0]
        
        if args.output and not args.skip_analysis:
            # For multi-clip runs, treat --output as an OUTPUT DIRECTORY (create it if needed).
            output_dir = _ensure_dir(args.output)
        else:
            # If output is a directory, use it; if it's a filename, use its directory; else default to input dir.
            if args.output and os.path.isdir(args.output):
                output_dir = args.output
            elif args.output and not os.path.isdir(args.output):
                output_dir = os.path.dirname(args.output) or os.path.dirname(input_video)
            else:
                output_dir = os.path.dirname(input_video)

    if not os.path.exists(input_video):
        print(f"❌ Input file not found: {input_video}")
        exit(1)

    with job_metrics.timed("source_preparation"):
        if args.defer_render:
            # Discovery needs a durable source reference, not an AV1 working
            # copy that would disappear before a later clip-render job.
            processing_video = input_video
        else:
            processing_video = prepare_opencv_video(input_video)
        manifest_source_path, source_asset, source_media = _prepare_manifest_source(
            input_video,
            output_dir,
            source_object,
        )
    source_analysis = None
    if not args.defer_render and args.render_clip is None:
        source_analysis = build_source_analysis_for_job(
            processing_video, output_dir, metrics=job_metrics
        )

    # 2. Decision: Analyze clips or process whole?
    if args.render_clip is not None:
        # The parent metadata is the source of truth for the selected clip;
        # this path intentionally performs no discovery or work for siblings.
        processing_video = prepare_opencv_video(manifest_source_path)
        render_deferred_clip(
            input_video=processing_video,
            output_dir=output_dir,
            clip_index=args.render_clip,
            metrics=job_metrics,
        )
    elif args.skip_analysis:
        print("⏩ Skipping analysis, processing entire video...")
        output_file = args.output if args.output else os.path.join(output_dir, f"{video_title}_vertical.mp4")
        process_video_to_vertical(
            processing_video,
            output_file,
            source_analysis=source_analysis,
            source_media=source_media,
            metrics=job_metrics,
            layout_format=args.layout_format,
            facecam_size=args.facecam_size,
        )
    else:
        # 3. Transcribe
        duration = float(source_media.duration_seconds)
        if duration <= 0:
            duration = source_analysis.total_frames / source_analysis.source_fps
        with job_metrics.timed("transcription"):
            transcript = transcribe_video(processing_video, duration_seconds=duration)

        source_context_record = prepare_source_context(args.source_url, transcript)
        
        # 4. Gemini Analysis
        with job_metrics.timed("ai_planning"):
            clips_data = get_viral_clips(
                transcript,
                duration,
                target_clips=target_clips,
                source_context=source_context_record.get("source_context"),
            )
        
        if not clips_data or 'shorts' not in clips_data:
            print("❌ Failed to identify clips. Converting whole video as fallback.")
            output_file = os.path.join(output_dir, f"{video_title}_vertical.mp4")
            process_video_to_vertical(
                processing_video,
                output_file,
                source_analysis=source_analysis,
                source_media=source_media,
                metrics=job_metrics,
                layout_format=args.layout_format,
                facecam_size=args.facecam_size,
            )
        else:
            print(f"🔥 Found {len(clips_data['shorts'])} viral clips!")
            attach_source_context_to_clip_plan(clips_data, source_context_record)
            if args.defer_render:
                _, metadata_file = persist_discovered_clip_plan(
                    clips_data,
                    output_dir=output_dir,
                    video_title=video_title,
                    source_path=manifest_source_path,
                    source_asset=source_asset,
                    source_media=source_media,
                    transcript=transcript,
                    source_object=source_object,
                    layout_format=args.layout_format,
                    facecam_size=args.facecam_size,
                )
                print(f"   Saved discovery metadata to {metadata_file}")
            else:
                # Preserve the legacy automatic all-clips rendering behavior.
                clips_data['transcript'] = transcript
                if source_object:
                    clips_data["source_object"] = dict(source_object)
                metadata_file = os.path.join(output_dir, f"{video_title}_metadata.json")
                with open(metadata_file, 'w') as f:
                    json.dump(clips_data, f, indent=2)
                print(f"   Saved metadata to {metadata_file}")
                clips_data["shorts"] = render_clip_plan(
                    input_video=processing_video,
                    output_dir=output_dir,
                    video_title=video_title,
                    clips=clips_data["shorts"],
                    source_analysis=source_analysis,
                    transcript=transcript,
                    source_asset=source_asset,
                    source_media=source_media,
                    source_object=source_object,
                    metrics=job_metrics,
                    layout_format=args.layout_format,
                    facecam_size=args.facecam_size,
                )
                with open(metadata_file, 'w', encoding='utf-8') as f:
                    json.dump(clips_data, f, indent=2)

    # Clean up original if requested
    if args.url and not args.keep_original and os.path.exists(input_video):
        os.remove(input_video)
        print(f"🗑️  Cleaned up downloaded video.")

    job_metrics.add_duration("total_wall_clock", time.time() - script_start_time)
    metrics_filename = (
        f"clip_{args.render_clip}_metrics.json"
        if args.render_clip is not None
        else "generation_metrics.json"
    )
    job_metrics.write_json(os.path.join(output_dir, metrics_filename))
    total_time = time.time() - script_start_time
    print(f"\n⏱️  Total execution time: {total_time:.2f}s")
