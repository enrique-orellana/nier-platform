import os
import uuid
import subprocess
import threading
import json
import shutil
import glob
import time
import asyncio
from dotenv import load_dotenv
from typing import Dict, Optional, List, Any
from contextlib import asynccontextmanager
from urllib.parse import urlsplit, urlunsplit
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Header, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from s3_uploader import upload_job_artifacts, delete_job_artifacts, list_all_clips, upload_actor_to_s3, list_actor_gallery, upload_video_to_gallery, list_video_gallery, upload_thumbnail_project, list_thumbnail_projects, update_thumbnail_project, delete_thumbnail_project, update_thumbnail_project_file, delete_thumbnail_project_file, migrate_legacy_thumbnail_projects, get_s3_client
from ai_client import AIConfig, load_ai_config, ai_config_to_env, discover_lmstudio_models

load_dotenv()

# Constants
UPLOAD_DIR = "uploads"
OUTPUT_DIR = "output"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Configuration
# Default to 1 if not set, but user can set higher for powerful servers
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "5"))
MAX_FILE_SIZE_MB = 2048  # 2GB limit
JOB_RETENTION_SECONDS = 3600  # 1 hour retention
DISABLE_YOUTUBE_URL = os.environ.get("DISABLE_YOUTUBE_URL", "false").lower() in ("1", "true", "yes")

# Application State
job_queue = asyncio.Queue()
jobs: Dict[str, Dict] = {}
thumbnail_sessions: Dict[str, Dict] = {}
publish_jobs: Dict[str, Dict] = {}  # {publish_id: {status, result, error}}
# Semester to limit concurrency to MAX_CONCURRENT_JOBS
concurrency_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


def build_ai_config(
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    analyze_model: Optional[str] = None,
    vision_model: Optional[str] = None,
    image_model: Optional[str] = None,
    extra: Optional[Dict[str, str]] = None,
) -> AIConfig:
    source = dict(extra or {})
    if provider:
        source["X-AI-Provider"] = provider
    if api_key:
        source["X-AI-Api-Key"] = api_key
    if base_url:
        source["X-AI-Base-Url"] = base_url
    if model:
        source["X-AI-Model"] = model
    if analyze_model:
        source["X-AI-Analyze-Model"] = analyze_model
    if vision_model:
        source["X-AI-Vision-Model"] = vision_model
    if image_model:
        source["X-AI-Image-Model"] = image_model
    ai_config = load_ai_config(source)
    if ai_config.is_ollama() and not ai_config.base_url:
        raise HTTPException(status_code=400, detail="Missing Ollama base URL. Set it in Settings.")
    return ai_config

def _relocate_root_job_artifacts(job_id: str, job_output_dir: str) -> bool:
    """
    Backward-compat rescue:
    If main.py accidentally wrote metadata/clips into OUTPUT_DIR root (e.g. output/<jobid>_...),
    move them into output/<job_id>/ so the API can find and serve them.
    """
    try:
        os.makedirs(job_output_dir, exist_ok=True)
        root = OUTPUT_DIR
        pattern = os.path.join(root, f"{job_id}_*_metadata.json")
        meta_candidates = sorted(glob.glob(pattern), key=lambda p: os.path.getmtime(p), reverse=True)
        if not meta_candidates:
            return False

        # Move the newest metadata and its associated clips.
        metadata_path = meta_candidates[0]
        base_name = os.path.basename(metadata_path).replace("_metadata.json", "")

        # Move metadata
        dest_metadata = os.path.join(job_output_dir, os.path.basename(metadata_path))
        if os.path.abspath(metadata_path) != os.path.abspath(dest_metadata):
            shutil.move(metadata_path, dest_metadata)

        # Move any clips that match the same base_name into the job folder
        clip_pattern = os.path.join(root, f"{base_name}_clip_*.mp4")
        for clip_path in glob.glob(clip_pattern):
            dest_clip = os.path.join(job_output_dir, os.path.basename(clip_path))
            if os.path.abspath(clip_path) != os.path.abspath(dest_clip):
                shutil.move(clip_path, dest_clip)

        # Also move any temp_ clips that might remain
        temp_clip_pattern = os.path.join(root, f"temp_{base_name}_clip_*.mp4")
        for clip_path in glob.glob(temp_clip_pattern):
            dest_clip = os.path.join(job_output_dir, os.path.basename(clip_path))
            if os.path.abspath(clip_path) != os.path.abspath(dest_clip):
                shutil.move(clip_path, dest_clip)

        return True
    except Exception:
        return False


def _rehydrate_job_from_disk(job_id: str) -> Optional[Dict]:
    """Rebuild a minimal job record from persisted output artifacts."""
    output_dir = os.path.join(OUTPUT_DIR, job_id)
    if not os.path.isdir(output_dir):
        return None

    json_files = sorted(
        glob.glob(os.path.join(output_dir, "*_metadata.json")),
        key=lambda p: os.path.getmtime(p),
        reverse=True,
    )
    if not json_files:
        return None

    metadata_path = json_files[0]
    with open(metadata_path, "r") as f:
        data = json.load(f)

    base_name = os.path.basename(metadata_path).replace("_metadata.json", "")
    clips = []
    for index, clip in enumerate(data.get("shorts", [])):
        normalized_clip = dict(clip)
        video_url = normalized_clip.get("video_url") or f"/videos/{job_id}/{base_name}_clip_{index + 1}.mp4"
        normalized_clip["video_url"] = f"/videos/{job_id}/{os.path.basename(video_url)}"
        clips.append(normalized_clip)

    return {
        "status": "completed",
        "logs": [f"Job rehydrated from persisted artifacts: {job_id}"],
        "result": {
            "clips": clips,
            "cost_analysis": data.get("cost_analysis"),
        },
        "output_dir": output_dir,
        "metadata_path": metadata_path,
    }


def _download_s3_object_to_file(s3_client, bucket_name: str, object_key: str, destination_path: str) -> bool:
    """Download an S3 object to a local file path."""
    try:
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)
        obj = s3_client.get_object(Bucket=bucket_name, Key=object_key)
        body = obj["Body"]
        with open(destination_path, "wb") as handle:
            for chunk in iter(lambda: body.read(1024 * 1024), b""):
                if not chunk:
                    break
                handle.write(chunk)
        return True
    except Exception as e:
        print(f"⚠️ Failed to download S3 object {object_key} -> {destination_path}: {e}")
        return False


def _rehydrate_job_from_s3(job_id: str) -> Optional[Dict]:
    """Rebuild a completed job from S3 artifacts and download files locally."""
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip()
    if not bucket_name:
        return None

    s3_client = get_s3_client()
    if not s3_client:
        return None

    output_dir = os.path.join(OUTPUT_DIR, job_id)
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=bucket_name, Prefix=f"{job_id}/")

        metadata_key = None
        clip_keys: list[str] = []
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj.get("Key", "")
                if key.endswith("_metadata.json"):
                    metadata_key = key
                elif key.endswith(".mp4"):
                    clip_keys.append(key)

        if not metadata_key:
            return None

        metadata_path = os.path.join(output_dir, os.path.basename(metadata_key))
        if not os.path.exists(metadata_path):
            if not _download_s3_object_to_file(s3_client, bucket_name, metadata_key, metadata_path):
                return None

        with open(metadata_path, "r") as f:
            data = json.load(f)

        base_name = os.path.basename(metadata_key).replace("_metadata.json", "")
        clips: list[Dict] = []
        for index, clip in enumerate(data.get("shorts", [])):
            normalized_clip = dict(clip)
            clip_filename = f"{base_name}_clip_{index + 1}.mp4"
            local_clip_path = os.path.join(output_dir, clip_filename)
            s3_clip_key = f"{job_id}/{clip_filename}"

            if not os.path.exists(local_clip_path):
                if s3_clip_key in clip_keys:
                    _download_s3_object_to_file(s3_client, bucket_name, s3_clip_key, local_clip_path)
                else:
                    # Fallback to any clip URL already present in the metadata.
                    source_url = normalized_clip.get("url") or normalized_clip.get("video_url") or ""
                    if source_url.startswith("http"):
                        try:
                            import httpx

                            with httpx.Client(timeout=300.0, follow_redirects=True) as client:
                                response = client.get(source_url)
                                response.raise_for_status()
                                os.makedirs(os.path.dirname(local_clip_path), exist_ok=True)
                                with open(local_clip_path, "wb") as handle:
                                    handle.write(response.content)
                        except Exception as e:
                            print(f"⚠️ Failed to hydrate clip from URL {source_url}: {e}")

            normalized_clip["video_url"] = f"/videos/{job_id}/{clip_filename}"
            clips.append(normalized_clip)

        return {
            "status": "completed",
            "logs": [f"Job rehydrated from S3 artifacts: {job_id}"],
            "result": {
                "clips": clips,
                "cost_analysis": data.get("cost_analysis"),
            },
            "output_dir": output_dir,
            "metadata_path": metadata_path,
        }
    except Exception as e:
        print(f"⚠️ Failed to rehydrate job {job_id} from S3: {e}")
        return None


def _get_job(job_id: str) -> Optional[Dict]:
    """Fetch a job from memory, or recover it from disk if the pod restarted."""
    job = jobs.get(job_id)
    if job:
        return job

    try:
        rehydrated = _rehydrate_job_from_disk(job_id)
        if rehydrated:
            jobs[job_id] = rehydrated
            return rehydrated
        rehydrated = _rehydrate_job_from_s3(job_id)
        if rehydrated:
            jobs[job_id] = rehydrated
            return rehydrated
    except Exception as e:
        print(f"⚠️ Failed to rehydrate job {job_id}: {e}")

    return None


def _resolve_job_clip_input(
    job_id: str,
    job: Dict,
    clip_index: int,
    requested_input_filename: Optional[str] = None,
) -> tuple[str, str]:
    """Resolve a clip to a local file path, downloading from S3/HTTP if needed."""
    if "result" not in job or "clips" not in job["result"]:
        raise HTTPException(status_code=400, detail="Job result not available")
    clips = job["result"]["clips"]
    if clip_index < 0 or clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")

    output_dir = os.path.join(OUTPUT_DIR, job_id)
    os.makedirs(output_dir, exist_ok=True)
    clip = clips[clip_index]

    candidates: list[str] = []
    if requested_input_filename:
        requested_name = os.path.basename(requested_input_filename.split("?")[0].split("#")[0].strip())
        if requested_name:
            candidates.append(requested_name)

    for key in ("video_url", "url"):
        raw_value = clip.get(key) or ""
        if not raw_value:
            continue
        parsed = urlsplit(raw_value)
        candidate_name = os.path.basename(parsed.path or raw_value.split("?")[0].split("#")[0])
        if candidate_name:
            candidates.append(candidate_name)

    # Prefer any existing local file.
    for candidate_name in dict.fromkeys(candidates):
        local_path = os.path.join(output_dir, candidate_name)
        if os.path.exists(local_path):
            return local_path, candidate_name

    # If we have a remote source URL, hydrate it locally.
    source_url = clip.get("url") or clip.get("video_url") or ""
    if source_url.startswith(("http://", "https://")):
        candidate_name = next((name for name in dict.fromkeys(candidates) if name), None)
        if not candidate_name:
            candidate_name = f"{job_id}_clip_{clip_index + 1}.mp4"
        local_path = os.path.join(output_dir, candidate_name)

        import httpx

        with httpx.Client(timeout=300.0, follow_redirects=True) as client:
            response = client.get(source_url)
            response.raise_for_status()
            with open(local_path, "wb") as handle:
                handle.write(response.content)
        return local_path, candidate_name

    # Final fallback: use the last path component if it already points at /videos/...
    if source_url.startswith("/videos/"):
        candidate_name = os.path.basename(urlsplit(source_url).path)
        if candidate_name:
            local_path = os.path.join(output_dir, candidate_name)
            if os.path.exists(local_path):
                return local_path, candidate_name

    raise HTTPException(status_code=404, detail="Video file not found for this clip")

async def cleanup_jobs():
    """Background task to remove old jobs and files."""
    import time
    print("🧹 Cleanup task started.")
    while True:
        try:
            await asyncio.sleep(300) # Check every 5 minutes
            now = time.time()
            
            # Simple directory cleanup based on modification time
            # Check OUTPUT_DIR
            for job_id in os.listdir(OUTPUT_DIR):
                job_path = os.path.join(OUTPUT_DIR, job_id)
                if os.path.isdir(job_path):
                    if now - os.path.getmtime(job_path) > JOB_RETENTION_SECONDS:
                        print(f"🧹 Purging old job: {job_id}")
                        shutil.rmtree(job_path, ignore_errors=True)
                        if job_id in jobs:
                            del jobs[job_id]

            # Cleanup SaaSShorts jobs from memory
            try:
                saas_expired = [
                    jid for jid, jdata in list(saas_jobs.items())
                    if jdata.get("status") in ("completed", "failed")
                    and jdata.get("output_dir")
                    and os.path.isdir(jdata["output_dir"])
                    and now - os.path.getmtime(jdata["output_dir"]) > JOB_RETENTION_SECONDS
                ]
                for jid in saas_expired:
                    del saas_jobs[jid]
            except NameError:
                pass

            # Cleanup Uploads
            for filename in os.listdir(UPLOAD_DIR):
                file_path = os.path.join(UPLOAD_DIR, filename)
                try:
                    if now - os.path.getmtime(file_path) > JOB_RETENTION_SECONDS:
                         os.remove(file_path)
                except Exception: pass

        except Exception as e:
            print(f"⚠️ Cleanup error: {e}")

async def process_queue():
    """Background worker to process jobs from the queue with concurrency limit."""
    print(f"🚀 Job Queue Worker started with {MAX_CONCURRENT_JOBS} concurrent slots.")
    while True:
        try:
            # Wait for a job
            job_id = await job_queue.get()
            
            # Acquire semaphore slot (waits if max jobs are running)
            await concurrency_semaphore.acquire()
            print(f"🔄 Acquired slot for job: {job_id}")

            # Process in background task to not block the loop (allowing other slots to fill)
            asyncio.create_task(run_job_wrapper(job_id))
            
        except Exception as e:
            print(f"❌ Queue dispatch error: {e}")
            await asyncio.sleep(1)

async def run_job_wrapper(job_id):
    """Wrapper to run job and release semaphore"""
    try:
        job = jobs.get(job_id)
        if job:
            await run_job(job_id, job)
    except Exception as e:
         print(f"❌ Job wrapper error {job_id}: {e}")
    finally:
        # Always release semaphore and mark queue task done
        concurrency_semaphore.release()
        job_queue.task_done()
        print(f"✅ Released slot for job: {job_id}")

startup_lmstudio_discovery = None

async def background_discover_lmstudio():
    global startup_lmstudio_discovery
    base_url = os.environ.get("VITE_AI_BASE_URL") or os.environ.get("AI_BASE_URL") or "http://host.docker.internal:1234"
    try:
        loop = asyncio.get_running_loop()
        discovered = await loop.run_in_executor(None, discover_lmstudio_models, base_url, "")
        if discovered and discovered.get("textModels"):
            startup_lmstudio_discovery = {
                "available": True,
                "provider": "lmstudio",
                "baseUrl": AIConfig(provider="lmstudio", base_url=base_url).resolved_base_url(),
                "textModels": discovered["textModels"],
                "visionModels": discovered["visionModels"],
            }
        else:
            startup_lmstudio_discovery = _lmstudio_discovery_failure(base_url)
    except Exception as e:
        print(f"Startup LM Studio discovery failed: {e}")
        startup_lmstudio_discovery = _lmstudio_discovery_failure(base_url)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start worker and cleanup
    worker_task = asyncio.create_task(process_queue())
    cleanup_task = asyncio.create_task(cleanup_jobs())
    discovery_task = asyncio.create_task(background_discover_lmstudio())
    yield
    # Cleanup (optional: cancel worker)

app = FastAPI(lifespan=lifespan)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for serving videos
app.mount("/videos", StaticFiles(directory=OUTPUT_DIR), name="videos")

# Mount static files for serving thumbnails
THUMBNAILS_DIR = os.path.join(OUTPUT_DIR, "thumbnails")
os.makedirs(THUMBNAILS_DIR, exist_ok=True)
app.mount("/thumbnails", StaticFiles(directory=THUMBNAILS_DIR), name="thumbnails")

class ProcessRequest(BaseModel):
    url: str

def enqueue_output(out, job_id):
    """Reads output from a subprocess and appends it to jobs logs."""
    try:
        for line in iter(out.readline, b''):
            decoded_line = line.decode('utf-8').strip()
            if decoded_line:
                print(f"📝 [Job Output] {decoded_line}")
                if job_id in jobs:
                    jobs[job_id]['logs'].append(decoded_line)
    except Exception as e:
        print(f"Error reading output for job {job_id}: {e}")
    finally:
        out.close()

async def run_job(job_id, job_data):
    """Executes the subprocess for a specific job."""
    
    cmd = job_data['cmd']
    env = job_data['env']
    output_dir = job_data['output_dir']
    
    jobs[job_id]['status'] = 'processing'
    jobs[job_id]['logs'].append("Job started by worker.")
    print(f"🎬 [run_job] Executing command for {job_id}: {' '.join(cmd)}")
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, # Merge stderr to stdout
            env=env,
            cwd=os.getcwd()
        )
        
        # We need to capture logs in a thread because Popen isn't async
        t_log = threading.Thread(target=enqueue_output, args=(process.stdout, job_id))
        t_log.daemon = True
        t_log.start()
        
        # Async wait for process with incremental updates
        start_wait = time.time()
        while process.poll() is None:
            await asyncio.sleep(2)
            
            # Check for partial results every 2 seconds
            # Look for metadata file
            try:
                json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))
                if json_files:
                    target_json = json_files[0]
                    # Read metadata (it might be being written to, so simple try/except or just read)
                    # Use a lock or just robust read? json.load might fail if file is partial.
                    # Usually main.py writes it once at start (based on my review).
                    if os.path.getsize(target_json) > 0:
                        with open(target_json, 'r') as f:
                            data = json.load(f)
                            
                        base_name = os.path.basename(target_json).replace('_metadata.json', '')
                        clips = data.get('shorts', [])
                        cost_analysis = data.get('cost_analysis')
                        
                        # Check which clips actually exist on disk
                        ready_clips = []
                        for i, clip in enumerate(clips):
                             clip_filename = f"{base_name}_clip_{i+1}.mp4"
                             clip_path = os.path.join(output_dir, clip_filename)
                             if os.path.exists(clip_path) and os.path.getsize(clip_path) > 0:
                                 # Checking if file is growing? For now assume if it exists and main.py moves it there, it's done.
                                 # main.py writes to temp_... then moves to final name. So presence means ready!
                                 clip['video_url'] = f"/videos/{job_id}/{clip_filename}"
                                 ready_clips.append(clip)
                        
                        if ready_clips:
                             jobs[job_id]['result'] = {'clips': ready_clips, 'cost_analysis': cost_analysis}
            except Exception as e:
                # Ignore read errors during processing
                pass

        returncode = process.returncode
        
        if returncode == 0:
            jobs[job_id]['logs'].append("Process finished successfully.")

            # Find result JSON
            json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))
            if not json_files:
                # Backward-compat rescue if outputs were written to OUTPUT_DIR root
                if _relocate_root_job_artifacts(job_id, output_dir):
                    json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))
            if json_files:
                target_json = json_files[0] 
                with open(target_json, 'r') as f:
                    data = json.load(f)
                
                # Enhance result with video URLs
                base_name = os.path.basename(target_json).replace('_metadata.json', '')
                clips = data.get('shorts', [])
                cost_analysis = data.get('cost_analysis')

                for i, clip in enumerate(clips):
                     clip_filename = f"{base_name}_clip_{i+1}.mp4"
                     clip['video_url'] = f"/videos/{job_id}/{clip_filename}"

                jobs[job_id]['result'] = {'clips': clips, 'cost_analysis': cost_analysis}
            else:
                 jobs[job_id]['status'] = 'failed'
                 jobs[job_id]['logs'].append("No metadata file generated.")

            # Persist the generated artifacts before marking the job complete,
            # so the Projects view can discover them right away.
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, upload_job_artifacts, output_dir, job_id)
                jobs[job_id]['logs'].append("Job artifacts saved to S3.")
            except Exception as upload_error:
                jobs[job_id]['logs'].append(f"Artifact upload warning: {upload_error}")

            jobs[job_id]['status'] = 'completed'
        else:
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['logs'].append(f"Process failed with exit code {returncode}")
            
    except Exception as e:
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['logs'].append(f"Execution error: {str(e)}")

class LmStudioDiscoveryRequest(BaseModel):
    baseUrl: str
    apiKey: Optional[str] = None


def _lmstudio_discovery_failure(base_url: str) -> dict[str, Any]:
    return {
        "available": False,
        "provider": "lmstudio",
        "baseUrl": base_url,
        "textModels": [],
        "visionModels": [],
        "error": "Unable to discover LM Studio models",
    }


@app.post("/api/ai/lmstudio/discover")
async def discover_lmstudio_endpoint(req: LmStudioDiscoveryRequest):
    base_url = (req.baseUrl or "").strip()
    if not base_url:
        return _lmstudio_discovery_failure(base_url)

    try:
        discovered = discover_lmstudio_models(base_url, api_key=(req.apiKey or "").strip())
    except Exception as exc:
        print(f"LM Studio discovery failed for {base_url}: {exc}")
        return _lmstudio_discovery_failure(base_url)

    if not discovered["textModels"]:
        return _lmstudio_discovery_failure(base_url)

    return {
        "available": True,
        "provider": "lmstudio",
        "baseUrl": AIConfig(provider="lmstudio", base_url=base_url).resolved_base_url(),
        "textModels": discovered["textModels"],
        "visionModels": discovered["visionModels"],
    }


@app.get("/api/config")
async def get_config():
    return {
        "youtubeUrlEnabled": not DISABLE_YOUTUBE_URL,
        "lmStudioConfig": startup_lmstudio_discovery
    }

@app.post("/api/process")
async def process_endpoint(
    request: Request,
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    acknowledged: Optional[str] = Form(None),
    clip_count: int = Query(6, ge=3, le=15),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_analyze_model: Optional[str] = Header(None, alias="X-AI-Analyze-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    ai_config = build_ai_config(
        provider=x_ai_provider or request.headers.get("X-Gemini-Key") and "gemini",
        api_key=x_ai_api_key or request.headers.get("X-Gemini-Key"),
        base_url=x_ai_base_url,
        model=x_ai_model,
        analyze_model=x_ai_analyze_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
        extra=dict(request.headers),
    )
    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API key")

    ack_flag = str(acknowledged).lower() in ("1", "true", "yes")
    # Handle JSON body manually for URL payload
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        url = body.get("url")
        ack_flag = bool(body.get("acknowledged"))

    if not url and not file:
        raise HTTPException(status_code=400, detail="Must provide URL or File")

    if not ack_flag:
        raise HTTPException(status_code=400, detail="You must confirm you own the content or have rights to process it.")

    if url and DISABLE_YOUTUBE_URL:
        raise HTTPException(status_code=403, detail="YouTube URL ingest is disabled on this deployment. Please upload a file you own.")

    # Capture attestation context for legal record (IP + timestamp + UA)
    client_ip = request.client.host if request.client else "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        client_ip = fwd.split(",")[0].strip()
    user_agent = request.headers.get("user-agent", "")
    attestation = {
        "acknowledged": True,
        "ip": client_ip,
        "user_agent": user_agent,
        "timestamp": time.time(),
        "source": "url" if url else "file",
    }

    job_id = str(uuid.uuid4())
    job_output_dir = os.path.join(OUTPUT_DIR, job_id)
    os.makedirs(job_output_dir, exist_ok=True)

    # Prepare Command
    cmd = ["python", "-u", "main.py"] # -u for unbuffered
    env = os.environ.copy()
    env.update(ai_config_to_env(ai_config))
    if url:
        cmd.extend(["-u", url])
    else:
        # Save uploaded file with size limit check
        input_path = os.path.join(UPLOAD_DIR, f"{job_id}_{file.filename}")

        # Read file in chunks to check size
        size = 0
        limit_bytes = MAX_FILE_SIZE_MB * 1024 * 1024

        with open(input_path, "wb") as buffer:
            while content := await file.read(1024 * 1024): # Read 1MB chunks
                size += len(content)
                if size > limit_bytes:
                    os.remove(input_path)
                    shutil.rmtree(job_output_dir)
                    raise HTTPException(status_code=413, detail=f"File too large. Max size {MAX_FILE_SIZE_MB}MB")
                buffer.write(content)

        cmd.extend(["-i", input_path])

    cmd.extend(["--target-clips", str(clip_count)])
    cmd.extend(["-o", job_output_dir])

    print(f"[attestation] job={job_id} ip={attestation['ip']} source={attestation['source']} ack=true")

    # Enqueue Job
    jobs[job_id] = {
        'status': 'queued',
        'logs': [f"Job {job_id} queued."],
        'cmd': cmd,
        'env': env,
        'output_dir': job_output_dir,
        'attestation': attestation
    }

    await job_queue.put(job_id)

    return {"job_id": job_id, "status": "queued"}

@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "status": job['status'],
        "logs": job['logs'],
        "result": job.get('result')
    }

from editor import VideoEditor
from subtitles import generate_srt, burn_subtitles, generate_srt_from_video
from hooks import add_hook_to_video
from translate import translate_video, get_supported_languages
from thumbnail import analyze_video_for_titles, refine_titles, generate_thumbnail, generate_youtube_description

class EditRequest(BaseModel):
    job_id: str
    clip_index: int
    api_key: Optional[str] = None
    input_filename: Optional[str] = None


class UpdateClipVideoUrlRequest(BaseModel):
    new_video_url: str


class ImproveClipQualityRequest(BaseModel):
    input_filename: Optional[str] = None


def _build_quality_ffmpeg_command(input_path: str, output_path: str) -> list[str]:
    """Build a higher-fidelity FFmpeg command for clip quality improvement."""
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-vf",
        "scale=iw:ih:flags=lanczos,unsharp=5:5:0.8:3:3:0.4",
        "-c:v",
        "libx264",
        "-preset",
        "slower",
        "-crf",
        "16",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        output_path,
    ]


def _persist_clip_video_url(job_id: str, clip_index: int, new_video_url: str) -> None:
    """Update the in-memory job record and persisted metadata for a clip URL."""
    job = _get_job(job_id)
    if not job or "result" not in job or "clips" not in job["result"]:
        raise HTTPException(status_code=404, detail="Job not found")

    clips = job["result"]["clips"]
    if clip_index < 0 or clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")

    clips[clip_index]["video_url"] = new_video_url
    clips[clip_index]["url"] = new_video_url

    output_dir = os.path.join(OUTPUT_DIR, job_id)
    json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))
    if not json_files:
        raise HTTPException(status_code=404, detail="Metadata not found")

    metadata_path = json_files[0]
    with open(metadata_path, "r") as f:
        data = json.load(f)

    metadata_clips = data.get("shorts", [])
    if clip_index < 0 or clip_index >= len(metadata_clips):
        raise HTTPException(status_code=404, detail="Clip not found")

    metadata_clips[clip_index]["video_url"] = new_video_url
    metadata_clips[clip_index]["url"] = new_video_url
    data["shorts"] = metadata_clips

    with open(metadata_path, "w") as f:
        json.dump(data, f, indent=4)


def _reencode_clip_for_quality(
    job_id: str,
    job: Dict,
    clip_index: int,
    requested_input_filename: Optional[str] = None,
) -> str:
    """Re-encode a clip at its current size with a higher-quality FFmpeg pass."""
    input_path, filename = _resolve_job_clip_input(
        job_id,
        job,
        clip_index,
        requested_input_filename,
    )

    output_dir = os.path.join(OUTPUT_DIR, job_id)
    os.makedirs(output_dir, exist_ok=True)

    base, ext = os.path.splitext(filename)
    output_filename = f"quality_{base}{ext or '.mp4'}"
    output_path = os.path.join(output_dir, output_filename)

    if os.path.exists(output_path):
        os.remove(output_path)

    ffmpeg_cmd = _build_quality_ffmpeg_command(input_path, output_path)
    subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return f"/videos/{job_id}/{output_filename}"

@app.post("/api/edit")
async def edit_clip(
    req: EditRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (req.api_key or x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=req.api_key or x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
        extra=dict(os.environ),
    )

    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API Key (Header or Body)")

    job = _get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if 'result' not in job or 'clips' not in job['result']:
        raise HTTPException(status_code=400, detail="Job result not available")
        
    try:
        input_path, filename = _resolve_job_clip_input(
            req.job_id,
            job,
            req.clip_index,
            req.input_filename,
        )

        # Define output path for edited video
        edited_filename = f"edited_{filename}"
        output_path = os.path.join(OUTPUT_DIR, req.job_id, edited_filename)
        
        # Run editing in a thread to avoid blocking main loop
        # Since VideoEditor uses blocking calls (subprocess, API wait)
        def run_edit():
            editor = VideoEditor(api_key_or_config=ai_config)
            
            # SAFE FILE RENAMING STRATEGY (Avoid UnicodeEncodeError in Docker)
            # Create a safe ASCII filename in the same directory
            safe_filename = f"temp_input_{req.job_id}.mp4"
            safe_input_path = os.path.join(OUTPUT_DIR, req.job_id, safe_filename)
            
            # Copy original file to safe path
            # (Copy is safer than rename if something crashes, we keep original)
            shutil.copy(input_path, safe_input_path)
            
            try:
                # 1. Upload (using safe path)
                vid_file = editor.upload_video(safe_input_path)
                
                # 2. Get duration
                import cv2
                cap = cv2.VideoCapture(safe_input_path)
                fps = cap.get(cv2.CAP_PROP_FPS)
                frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                duration = frame_count / fps if fps else 0
                cap.release()
                
                # Load transcript from metadata
                transcript = None
                try:
                    meta_files = glob.glob(os.path.join(OUTPUT_DIR, req.job_id, "*_metadata.json"))
                    if meta_files:
                        with open(meta_files[0], 'r') as f:
                            data = json.load(f)
                            transcript = data.get('transcript')
                except Exception as e:
                    print(f"⚠️ Could not load transcript for editing context: {e}")

                # 3. Get Plan (Filter String)
                filter_data = editor.get_ffmpeg_filter(vid_file, duration, fps=fps, width=width, height=height, transcript=transcript)
                
                # 4. Apply
                # Use safe output name first
                safe_output_path = os.path.join(OUTPUT_DIR, req.job_id, f"temp_output_{req.job_id}.mp4")
                editor.apply_edits(safe_input_path, safe_output_path, filter_data)
                
                # Move result to final destination (rename works even if dest name has unicode if filesystem supports it, 
                # but python might still struggle if locale is broken? No, os.rename usually handles it better than subprocess args)
                # Actually, output_path is defined above: f"edited_{filename}"
                # If filename has unicode, output_path has unicode.
                # Let's hope shutil.move / os.rename works.
                if os.path.exists(safe_output_path):
                    shutil.move(safe_output_path, output_path)
                
                return filter_data
            finally:
                # Cleanup temp safe input
                if os.path.exists(safe_input_path):
                    os.remove(safe_input_path)

        # Run in thread pool
        loop = asyncio.get_event_loop()
        plan = await loop.run_in_executor(None, run_edit)
        
        # Update clip URL in the job result? 
        # Or return new URL and let frontend handle it?
        # Updating job result allows persistence if page refreshes.
        
        new_video_url = f"/videos/{req.job_id}/{edited_filename}"
        
        # Start a new "edited" clip entry or just update the current one?
        # Let's update the current one's video_url but keep backup?
        # Or return the new URL to the frontend to display.
        
        return {
            "success": True, 
            "new_video_url": new_video_url,
            "edit_plan": plan
        }

    except Exception as e:
        print(f"❌ Edit Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class SubtitleRequest(BaseModel):
    job_id: str
    clip_index: int
    position: str = "bottom" # top, middle, bottom
    font_size: int = 16
    font_name: str = "Verdana"
    font_color: str = "#FFFFFF"
    border_color: str = "#000000"
    border_width: int = 2
    bg_color: str = "#000000"
    bg_opacity: float = 0.0
    input_filename: Optional[str] = None


@app.get("/api/clip/{job_id}/{clip_index}/transcript")
async def get_clip_transcript(job_id: str, clip_index: int):
    """Return word-level captions for a specific clip, formatted for Remotion."""
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    output_dir = os.path.join(OUTPUT_DIR, job_id)
    json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))

    if not json_files:
        raise HTTPException(status_code=404, detail="Metadata not found")

    with open(json_files[0], 'r') as f:
        data = json.load(f)

    transcript = data.get('transcript')
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript not found in metadata")

    clips = data.get('shorts', [])
    if clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")

    clip_data = clips[clip_index]
    clip_start = clip_data.get('start', 0)
    clip_end = clip_data.get('end', 0)

    # Extract words within clip range and convert to CaptionWord format
    captions = []
    for segment in transcript.get('segments', []):
        for word_info in segment.get('words', []):
            if word_info['end'] > clip_start and word_info['start'] < clip_end:
                captions.append({
                    "text": word_info.get('word', '').strip(),
                    "startMs": int((max(0, word_info['start'] - clip_start)) * 1000),
                    "endMs": int((max(0, word_info['end'] - clip_start)) * 1000),
                })

    duration_sec = clip_end - clip_start

    return {
        "captions": captions,
        "durationSec": duration_sec,
        "language": transcript.get('language', 'en'),
    }


# --- Remotion Render Proxy ---
RENDER_SERVICE_URL = os.getenv("RENDER_SERVICE_URL", "http://renderer:3100")
RENDER_BACKEND_PROXY_TARGET = os.getenv("VITE_BACKEND_PROXY_TARGET") or (
    "http://openshorts-backend:8000"
    if (os.getenv("KUBERNETES_SERVICE_HOST") or os.getenv("KUBERNETES_PORT"))
    else "http://backend:8000"
)


def _resolve_render_video_url_for_renderer(video_url: str, request: Request) -> str:
    if not isinstance(video_url, str) or not video_url:
        return video_url

    if video_url.startswith("/api/video-proxy"):
        return f"{RENDER_BACKEND_PROXY_TARGET}{video_url}"

    parsed = urlsplit(video_url)
    request_base = str(request.base_url).rstrip("/")
    request_netloc = urlsplit(request_base).netloc
    if parsed.netloc == request_netloc and parsed.path.startswith("/api/video-proxy"):
        suffix = parsed.path
        if parsed.query:
            suffix = f"{suffix}?{parsed.query}"
        return f"{RENDER_BACKEND_PROXY_TARGET}{suffix}"

    return video_url

@app.post("/api/render")
async def proxy_render(request: Request):
    """Proxy render requests to the Node.js Remotion render service."""
    import httpx
    body = await request.json()
    props = body.get("props") if isinstance(body, dict) else None
    if isinstance(props, dict) and isinstance(props.get("videoUrl"), str):
        props["videoUrl"] = _resolve_render_video_url_for_renderer(props["videoUrl"], request)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{RENDER_SERVICE_URL}/render", json=body)
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Render service unavailable: {e}")

@app.get("/api/render/{render_id}")
async def proxy_render_status(render_id: str):
    """Proxy render status polling to the Node.js Remotion render service."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{RENDER_SERVICE_URL}/render/{render_id}")
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Render service unavailable: {e}")


# --- Video Proxy (solves MinIO CORS for Remotion Player) ---

@app.get("/api/video-proxy")
@app.get("/api/video-proxy/{filename:path}")
async def video_proxy(request: Request, url: str = Query(...), filename: str | None = None):
    """
    Proxy a MinIO presigned video URL back to the browser with correct
    CORS and Range headers so that Remotion's Player can decode it.

    MinIO in this setup does not support PutBucketCors via the S3 API, so
    the browser's cross-origin range requests get blocked.  Routing via this
    same-origin endpoint eliminates the CORS constraint entirely.
    """
    import httpx
    from fastapi.responses import StreamingResponse

    # Basic safety: only allow requests to the configured MinIO endpoint
    public_endpoint = os.environ.get("AWS_S3_PUBLIC_ENDPOINT_URL", "") or \
                      os.environ.get("AWS_S3_PUBLIC_URL_BASE", "")
    if public_endpoint:
        parsed_target = urlsplit(url)
        parsed_allowed = urlsplit(public_endpoint)
        if parsed_target.netloc != parsed_allowed.netloc:
            raise HTTPException(status_code=403, detail="Proxy only allowed for configured MinIO endpoint")

    # Forward Range header if present (needed for video seeking)
    upstream_headers = {}
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    internal_endpoint = os.environ.get("AWS_S3_ENDPOINT_URL", "")
    if internal_endpoint and public_endpoint:
        parsed_target = urlsplit(url)
        parsed_internal = urlsplit(internal_endpoint)
        original_netloc = parsed_target.netloc
        url = urlunsplit((
            parsed_internal.scheme,
            parsed_internal.netloc,
            parsed_target.path,
            parsed_target.query,
            parsed_target.fragment
        ))
        upstream_headers["Host"] = original_netloc

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            upstream = await client.get(url, headers=upstream_headers)

        status_code = upstream.status_code  # 200 or 206 (partial content)

        response_headers = {
            "Content-Type": upstream.headers.get("content-type", "video/mp4"),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag",
        }
        if "content-length" in upstream.headers:
            response_headers["Content-Length"] = upstream.headers["content-length"]
        if "content-range" in upstream.headers:
            response_headers["Content-Range"] = upstream.headers["content-range"]
        if "etag" in upstream.headers:
            response_headers["ETag"] = upstream.headers["etag"]
        if filename:
            response_headers["Content-Disposition"] = f'inline; filename="{filename}"'

        return StreamingResponse(
            iter([upstream.content]),
            status_code=status_code,
            headers=response_headers,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Video proxy error: {e}")


@app.post("/api/clip/{job_id}/{clip_index}/video-url")
async def update_clip_video_url(job_id: str, clip_index: int, req: UpdateClipVideoUrlRequest):
    """Persist a new clip video URL in memory and in the metadata file."""
    _persist_clip_video_url(job_id, clip_index, req.new_video_url)
    return {
        "success": True,
        "job_id": job_id,
        "clip_index": clip_index,
        "video_url": req.new_video_url,
    }


@app.post("/api/clip/{job_id}/{clip_index}/quality")
async def improve_clip_quality(job_id: str, clip_index: int, req: ImproveClipQualityRequest):
    """Re-encode a clip in place with a higher-quality FFmpeg pass."""
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        new_video_url = _reencode_clip_for_quality(job_id, job, clip_index, req.input_filename)
        _persist_clip_video_url(job_id, clip_index, new_video_url)
        return {
            "success": True,
            "job_id": job_id,
            "clip_index": clip_index,
            "video_url": new_video_url,
        }
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode() if e.stderr else "Unknown FFmpeg error"
        raise HTTPException(status_code=500, detail=f"Quality re-encode failed: {stderr}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EffectsGenerateRequest(BaseModel):
    job_id: str
    clip_index: int
    input_filename: Optional[str] = None

@app.post("/api/effects/generate")
async def generate_effects_config(
    req: EffectsGenerateRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    """Generate structured EffectsConfig JSON for Remotion rendering via the selected AI provider."""
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
    )

    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API Key (Header)")

    job = _get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if 'result' not in job or 'clips' not in job['result']:
        raise HTTPException(status_code=400, detail="Job result not available")

    try:
        input_path, filename = _resolve_job_clip_input(
            req.job_id,
            job,
            req.clip_index,
            req.input_filename,
        )

        def run_effects_generation():
            editor = VideoEditor(api_key_or_config=ai_config)

            # Create safe ASCII filename to avoid encoding issues
            safe_filename = f"temp_effects_{req.job_id}.mp4"
            safe_input_path = os.path.join(OUTPUT_DIR, req.job_id, safe_filename)
            shutil.copy(input_path, safe_input_path)

            try:
                vid_file = editor.upload_video(safe_input_path)

                # Get video metadata via ffprobe
                probe_cmd = [
                    'ffprobe', '-v', 'error',
                    '-select_streams', 'v:0',
                    '-show_entries', 'stream=width,height,r_frame_rate,duration',
                    '-show_entries', 'format=duration',
                    '-of', 'json',
                    safe_input_path
                ]
                probe_result = subprocess.check_output(probe_cmd).decode().strip()
                probe_data = json.loads(probe_result)

                stream = probe_data.get('streams', [{}])[0]
                width = int(stream.get('width', 1080))
                height = int(stream.get('height', 1920))

                # Parse fps from r_frame_rate (e.g. "30/1")
                r_frame_rate = stream.get('r_frame_rate', '30/1')
                num, den = r_frame_rate.split('/')
                fps = round(int(num) / int(den), 2)

                # Get duration from stream or format
                duration = float(stream.get('duration', 0))
                if duration == 0:
                    duration = float(probe_data.get('format', {}).get('duration', 0))

                # Load transcript from metadata
                transcript = None
                try:
                    meta_files = glob.glob(os.path.join(OUTPUT_DIR, req.job_id, "*_metadata.json"))
                    if meta_files:
                        with open(meta_files[0], 'r') as f:
                            data = json.load(f)
                            transcript = data.get('transcript')
                except Exception as e:
                    print(f"⚠️ Could not load transcript for effects config: {e}")

                # Generate effects config
                effects_config = editor.get_effects_config(
                    vid_file, duration, fps=fps, width=width, height=height, transcript=transcript
                )

                return effects_config
            finally:
                if os.path.exists(safe_input_path):
                    os.remove(safe_input_path)

        loop = asyncio.get_event_loop()
        effects_config = await loop.run_in_executor(None, run_effects_generation)

        if effects_config is None:
            raise HTTPException(status_code=500, detail="Failed to generate effects config from Gemini")

        return {"effects": effects_config}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Effects Generation Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/subtitle")
async def add_subtitles(req: SubtitleRequest):
    job = _get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # We need to access metadata.json to get the transcript
    output_dir = os.path.join(OUTPUT_DIR, req.job_id)
    json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))
    
    if not json_files:
        raise HTTPException(status_code=404, detail="Metadata not found")
        
    with open(json_files[0], 'r') as f:
        data = json.load(f)
        
    transcript = data.get('transcript')
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript not found in metadata. Please process a new video.")
        
    clips = data.get('shorts', [])
    if req.clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")
        
    clip_data = clips[req.clip_index]
    
    input_path, filename = _resolve_job_clip_input(
        req.job_id,
        job,
        req.clip_index,
        req.input_filename,
    )
        
    # Define outputs
    srt_filename = f"subs_{req.clip_index}_{int(time.time())}.srt"
    srt_path = os.path.join(output_dir, srt_filename)
    
    # Output video
    # We create a new file "subtitled_..."
    output_filename = f"subtitled_{filename}"
    output_path = os.path.join(output_dir, output_filename)
    
    try:
        # 1. Generate SRT
        # Check if this is a dubbed video - if so, transcribe it fresh
        is_dubbed = filename.startswith("translated_")

        if is_dubbed:
            print(f"🎙️ Dubbed video detected, transcribing audio for subtitles...")
            def run_transcribe_srt():
                return generate_srt_from_video(input_path, srt_path)

            loop = asyncio.get_event_loop()
            success = await loop.run_in_executor(None, run_transcribe_srt)
        else:
            success = generate_srt(transcript, clip_data['start'], clip_data['end'], srt_path)

        if not success:
             raise HTTPException(status_code=400, detail="No words found for this clip range.")

        # 2. Burn Subtitles
        # Run in thread pool
        def run_burn():
             burn_subtitles(input_path, srt_path, output_path,
                           alignment=req.position, fontsize=req.font_size,
                           font_name=req.font_name, font_color=req.font_color,
                           border_color=req.border_color, border_width=req.border_width,
                           bg_color=req.bg_color, bg_opacity=req.bg_opacity)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, run_burn)
        
    except Exception as e:
        print(f"❌ Subtitle Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
    # 3. Update Result and Metadata
    # Update InMemory Jobs
    if req.clip_index < len(job['result']['clips']):
         job['result']['clips'][req.clip_index]['video_url'] = f"/videos/{req.job_id}/{output_filename}"
    
    # Update Metadata on Disk (Persistence)
    try:
        if req.clip_index < len(clips):
            clips[req.clip_index]['video_url'] = f"/videos/{req.job_id}/{output_filename}"
            # Update the main data structure
            data['shorts'] = clips
            
            # Write back
            with open(json_files[0], 'w') as f:
                json.dump(data, f, indent=4)
                print(f"✅ Metadata updated with subtitled video for clip {req.clip_index}")
    except Exception as e:
        print(f"⚠️ Failed to update metadata.json: {e}")
        # Non-critical, but good for persistence

    return {
        "success": True,
        "new_video_url": f"/videos/{req.job_id}/{output_filename}"
    }

class HookRequest(BaseModel):
    job_id: str
    clip_index: int
    text: str
    input_filename: Optional[str] = None
    position: Optional[str] = "top" # top, center, bottom
    size: Optional[str] = "M" # S, M, L

@app.post("/api/hook")
async def add_hook(req: HookRequest):
    job = _get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    output_dir = os.path.join(OUTPUT_DIR, req.job_id)
    json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))
    
    if not json_files:
        raise HTTPException(status_code=404, detail="Metadata not found")
        
    with open(json_files[0], 'r') as f:
        data = json.load(f)
        
    clips = data.get('shorts', [])
    if req.clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")
        
    clip_data = clips[req.clip_index]
    
    input_path, filename = _resolve_job_clip_input(
        req.job_id,
        job,
        req.clip_index,
        req.input_filename,
    )
        
    # Output video
    output_filename = f"hook_{filename}"
    output_path = os.path.join(output_dir, output_filename)
    
    # Map Size to Scale
    size_map = {"S": 0.8, "M": 1.0, "L": 1.3}
    font_scale = size_map.get(req.size, 1.0)
    
    try:
        # Run in thread pool
        def run_hook():
             add_hook_to_video(input_path, req.text, output_path, position=req.position, font_scale=font_scale)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, run_hook)
        
    except Exception as e:
        print(f"❌ Hook Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
    # Update Persistence (Same logic as subtitles)
    # Update InMemory Jobs
    if req.clip_index < len(job['result']['clips']):
         job['result']['clips'][req.clip_index]['video_url'] = f"/videos/{req.job_id}/{output_filename}"
    
    # Update Metadata on Disk
    try:
        if req.clip_index < len(clips):
            clips[req.clip_index]['video_url'] = f"/videos/{req.job_id}/{output_filename}"
            data['shorts'] = clips
            with open(json_files[0], 'w') as f:
                json.dump(data, f, indent=4)
                print(f"✅ Metadata updated with hook video for clip {req.clip_index}")
    except Exception as e:
        print(f"⚠️ Failed to update metadata.json: {e}")

    return {
        "success": True,
        "new_video_url": f"/videos/{req.job_id}/{output_filename}"
    }

class TranslateRequest(BaseModel):
    job_id: str
    clip_index: int
    target_language: str
    source_language: Optional[str] = None
    input_filename: Optional[str] = None

@app.get("/api/translate/languages")
async def get_languages():
    """Return supported languages for translation."""
    return {"languages": get_supported_languages()}

@app.post("/api/translate")
async def translate_clip(
    req: TranslateRequest,
    x_elevenlabs_key: Optional[str] = Header(None, alias="X-ElevenLabs-Key")
):
    """Translate a video clip to a different language using ElevenLabs dubbing."""
    if not x_elevenlabs_key:
        raise HTTPException(status_code=400, detail="Missing X-ElevenLabs-Key header")

    job = _get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    output_dir = os.path.join(OUTPUT_DIR, req.job_id)
    json_files = glob.glob(os.path.join(output_dir, "*_metadata.json"))

    if not json_files:
        raise HTTPException(status_code=404, detail="Metadata not found")

    with open(json_files[0], 'r') as f:
        data = json.load(f)

    clips = data.get('shorts', [])
    if req.clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")

    clip_data = clips[req.clip_index]

    input_path, filename = _resolve_job_clip_input(
        req.job_id,
        job,
        req.clip_index,
        req.input_filename,
    )

    # Output video with language suffix
    base, ext = os.path.splitext(filename)
    output_filename = f"translated_{req.target_language}_{base}{ext}"
    output_path = os.path.join(output_dir, output_filename)

    try:
        # Run translation in thread pool (blocking API calls)
        def run_translate():
            return translate_video(
                video_path=input_path,
                output_path=output_path,
                target_language=req.target_language,
                api_key=x_elevenlabs_key,
                source_language=req.source_language,
            )

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, run_translate)

    except Exception as e:
        print(f"❌ Translation Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Update InMemory Jobs
    if req.clip_index < len(job['result']['clips']):
         job['result']['clips'][req.clip_index]['video_url'] = f"/videos/{req.job_id}/{output_filename}"

    # Update Metadata on Disk
    try:
        if req.clip_index < len(clips):
            clips[req.clip_index]['video_url'] = f"/videos/{req.job_id}/{output_filename}"
            data['shorts'] = clips
            with open(json_files[0], 'w') as f:
                json.dump(data, f, indent=4)
                print(f"✅ Metadata updated with translated video for clip {req.clip_index}")
    except Exception as e:
        print(f"⚠️ Failed to update metadata.json: {e}")

    return {
        "success": True,
        "new_video_url": f"/videos/{req.job_id}/{output_filename}"
    }

class SocialPostRequest(BaseModel):
    job_id: str
    clip_index: int
    api_key: str
    user_id: str
    platforms: List[str] # ["tiktok", "instagram", "youtube"]
    # Optional overrides if frontend wants to edit them
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_date: Optional[str] = None # ISO-8601 string
    timezone: Optional[str] = "UTC"

import httpx

@app.post("/api/social/post")
async def post_to_socials(req: SocialPostRequest):
    job = _get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if 'result' not in job or 'clips' not in job['result']:
        raise HTTPException(status_code=400, detail="Job result not available")
        
    try:
        clip = job['result']['clips'][req.clip_index]
        # Video URL is relative /videos/..., we need absolute file path
        # clip['video_url'] is like "/videos/{job_id}/{filename}"
        # We constructed it as: f"/videos/{job_id}/{clip_filename}"
        # And file is at f"{OUTPUT_DIR}/{job_id}/{clip_filename}"
        
        filename = clip['video_url'].split('/')[-1]
        file_path = os.path.join(OUTPUT_DIR, req.job_id, filename)
        
        if not os.path.exists(file_path):
             raise HTTPException(status_code=404, detail=f"Video file not found: {file_path}")

        # Construct parameters for Upload-Post API
        # Fallbacks
        final_title = req.title or clip.get('title', 'Viral Short')
        final_description = req.description or clip.get('video_description_for_instagram') or clip.get('video_description_for_tiktok') or "Check this out!"
        
        # Prepare form data
        url = "https://api.upload-post.com/api/upload"
        headers = {
            "Authorization": f"Apikey {req.api_key}"
        }
        
        # Prepare data as dict (httpx handles lists for multiple values)
        data_payload = {
            "user": req.user_id,
            "title": final_title,
            "platform[]": req.platforms, # Pass list directly
            "async_upload": "true"  # Enable async upload
        }

        # Add scheduling if present
        if req.scheduled_date:
            data_payload["scheduled_date"] = req.scheduled_date
            if req.timezone:
                data_payload["timezone"] = req.timezone
        
        # Add Platform specifics
        if "tiktok" in req.platforms:
             data_payload["tiktok_title"] = final_description
             
        if "instagram" in req.platforms:
             data_payload["instagram_title"] = final_description
             data_payload["media_type"] = "REELS"

        if "youtube" in req.platforms:
             yt_title = req.title or clip.get('video_title_for_youtube_short', final_title)
             data_payload["youtube_title"] = yt_title
             data_payload["youtube_description"] = final_description
             data_payload["privacyStatus"] = "public"

        # Send File
        # httpx AsyncClient requires async file reading or bytes. 
        # Since we have MAX_FILE_SIZE_MB, reading into memory is safe-ish.
        with open(file_path, "rb") as f:
            file_content = f.read()
            
        files = {
            "video": (filename, file_content, "video/mp4")
        }

        # Switch to synchronous Client to avoid "sync request with AsyncClient" error with multipart/files
        with httpx.Client(timeout=120.0) as client:
            print(f"📡 Sending to Upload-Post for platforms: {req.platforms}")
            response = client.post(url, headers=headers, data=data_payload, files=files)
            
        if response.status_code not in [200, 201, 202]: # Added 201
             print(f"❌ Upload-Post Error: {response.text}")
             raise HTTPException(status_code=response.status_code, detail=f"Vendor API Error: {response.text}")

        return response.json()

    except Exception as e:
        print(f"❌ Social Post Exception: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/social/user")
async def get_social_user(api_key: str = Header(..., alias="X-Upload-Post-Key")):
    """Proxy to fetch user ID from Upload-Post"""
    if not api_key:
         raise HTTPException(status_code=400, detail="Missing X-Upload-Post-Key header")
         
    url = "https://api.upload-post.com/api/uploadposts/users"
    print(f"🔍 Fetching User ID from: {url}")
    headers = {"Authorization": f"Apikey {api_key}"}
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                print(f"❌ Upload-Post User Fetch Error: {resp.text}")
                raise HTTPException(status_code=resp.status_code, detail=f"Failed to fetch user: {resp.text}")
            
            data = resp.json()
            print(f"🔍 Upload-Post User Response: {data}")
            
            user_id = None
            # The structure is {'success': True, 'profiles': [{'username': '...'}, ...]}
            profiles_list = []
            if isinstance(data, dict):
                 raw_profiles = data.get('profiles', [])
                 if isinstance(raw_profiles, list):
                     for p in raw_profiles:
                         username = p.get('username')
                         if username:
                             # Determine connected platforms
                             socials = p.get('social_accounts', {})
                             connected = []
                             # Check typical platforms
                             for platform in ['tiktok', 'instagram', 'youtube']:
                                 account_info = socials.get(platform)
                                 # If it's a dict and typically has data, or just not empty string
                                 if isinstance(account_info, dict):
                                     connected.append(platform)
                             
                             profiles_list.append({
                                 "username": username,
                                 "connected": connected
                             })
            
            if not profiles_list:
                # Fallback if no profiles found
                return {"profiles": [], "error": "No profiles found"}
                
            return {"profiles": profiles_list}
            
            
        except Exception as e:
             raise HTTPException(status_code=500, detail=str(e))

# --- Thumbnail Studio Endpoints ---

@app.post("/api/thumbnail/upload")
async def thumbnail_upload(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
):
    """Upload video and start background Whisper transcription immediately."""
    if not url and not file:
        raise HTTPException(status_code=400, detail="Must provide URL or File")

    session_id = str(uuid.uuid4())
    transcript_event = asyncio.Event()

    # Save file if uploaded directly
    video_path = None
    if file:
        video_path = os.path.join(UPLOAD_DIR, f"thumb_{session_id}_{file.filename}")
        with open(video_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

    # Initialize session
    thumbnail_sessions[session_id] = {
        "video_path": video_path,
        "transcript_event": transcript_event,
        "transcript_ready": False,
        "transcript": None,
        "transcript_segments": [],
        "video_duration": 0,
        "language": "en",
        "context": "",
        "titles": [],
        "conversation": [],
        "_url": url,  # Store URL for deferred download
    }

    async def run_background_whisper():
        try:
            vpath = video_path
            # Download YouTube video if URL was provided
            if not vpath and url:
                from main import download_youtube_video
                loop = asyncio.get_event_loop()
                vpath, _ = await loop.run_in_executor(None, download_youtube_video, url, UPLOAD_DIR)
                thumbnail_sessions[session_id]["video_path"] = vpath

            from main import transcribe_video
            loop = asyncio.get_event_loop()
            transcript = await loop.run_in_executor(None, transcribe_video, vpath)
            segments = transcript.get("segments", [])
            duration = segments[-1]["end"] if segments else 0

            thumbnail_sessions[session_id].update({
                "transcript_ready": True,
                "transcript": transcript,
                "transcript_segments": segments,
                "video_duration": duration,
                "language": transcript.get("language", "en"),
            })
            print(f"✅ [Thumbnail] Background Whisper complete for session {session_id}")
        except Exception as e:
            print(f"❌ [Thumbnail] Background Whisper failed: {e}")
            thumbnail_sessions[session_id]["transcript_error"] = str(e)
        finally:
            transcript_event.set()

    asyncio.create_task(run_background_whisper())

    return {"session_id": session_id}


@app.post("/api/thumbnail/analyze")
async def thumbnail_analyze(
    request: Request,
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    """Analyze a video and suggest viral YouTube titles."""
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
    )
    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing X-Gemini-Key header")

    pre_transcript = None

    # Check for pre-existing session with background Whisper
    if session_id and session_id in thumbnail_sessions:
        session = thumbnail_sessions[session_id]

        # Wait for background Whisper to complete
        transcript_event = session.get("transcript_event")
        if transcript_event:
            print(f"⏳ [Thumbnail] Waiting for background Whisper to finish...")
            await transcript_event.wait()

        if session.get("transcript_error"):
            raise HTTPException(status_code=500, detail=f"Transcription failed: {session['transcript_error']}")

        video_path = session["video_path"]
        if not video_path or not os.path.exists(video_path):
            raise HTTPException(status_code=404, detail="Video file not found in session")

        if session.get("transcript_ready"):
            pre_transcript = session["transcript"]
    else:
        # No pre-existing session — need file or URL
        if not url and not file:
            raise HTTPException(status_code=400, detail="Must provide URL, File, or session_id")

        session_id = str(uuid.uuid4())

        if url:
            from main import download_youtube_video
            video_path, _ = download_youtube_video(url, UPLOAD_DIR)
        else:
            video_path = os.path.join(UPLOAD_DIR, f"thumb_{session_id}_{file.filename}")
            with open(video_path, "wb") as buffer:
                content = await file.read()
                buffer.write(content)

    try:
        # Run analysis in thread pool (skips Whisper if pre_transcript is available)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, analyze_video_for_titles, ai_config, video_path, pre_transcript)

        # Store/update session context
        if session_id not in thumbnail_sessions:
            thumbnail_sessions[session_id] = {}

        thumbnail_sessions[session_id].update({
            "context": result.get("transcript_summary", ""),
            "titles": result.get("titles", []),
            "language": result.get("language", "en"),
            "conversation": thumbnail_sessions[session_id].get("conversation", []),
            "video_path": video_path,
            "transcript_segments": result.get("segments", []),
            "video_duration": result.get("video_duration", 0)
        })

        return {
            "session_id": session_id,
            "titles": result.get("titles", []),
            "context": result.get("transcript_summary", ""),
            "language": result.get("language", "en"),
            "recommended": result.get("recommended", [])
        }

    except Exception as e:
        print(f"❌ Thumbnail Analyze Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ThumbnailTitlesRequest(BaseModel):
    session_id: Optional[str] = None
    message: Optional[str] = None
    title: Optional[str] = None

@app.post("/api/thumbnail/titles")
async def thumbnail_titles(
    req: ThumbnailTitlesRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    """Refine title suggestions or accept a manual title."""
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
    )
    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing X-Gemini-Key header")

    # Manual title mode - just create a session with the user's title
    if req.title:
        session_id = req.session_id or str(uuid.uuid4())
        if session_id not in thumbnail_sessions:
            thumbnail_sessions[session_id] = {
                "context": "",
                "titles": [req.title],
                "language": "en",
                "conversation": []
            }
        return {"session_id": session_id, "titles": [req.title]}

    # Refinement mode
    if not req.session_id or req.session_id not in thumbnail_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    if not req.message:
        raise HTTPException(status_code=400, detail="Must provide message or title")

    session = thumbnail_sessions[req.session_id]

    # Add user message to conversation history
    session["conversation"].append({"role": "user", "content": req.message})

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            refine_titles,
            ai_config,
            session["context"],
            req.message,
            session["conversation"]
        )

        new_titles = result.get("titles", [])
        session["titles"] = new_titles
        session["conversation"].append({"role": "assistant", "content": json.dumps(new_titles)})

        return {"titles": new_titles}

    except Exception as e:
        print(f"❌ Thumbnail Titles Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/thumbnail/generate")
async def thumbnail_generate(
    request: Request,
    session_id: str = Form(...),
    title: str = Form(...),
    extra_prompt: str = Form(""),
    count: int = Form(3),
    face: Optional[UploadFile] = File(None),
    background: Optional[UploadFile] = File(None),
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    """Generate YouTube thumbnails with Gemini image generation."""
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
    )
    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing X-Gemini-Key header")

    # Clamp count
    count = min(max(1, count), 6)

    # Save optional uploaded images
    face_path = None
    bg_path = None
    thumb_upload_dir = os.path.join(UPLOAD_DIR, f"thumb_{session_id}")
    os.makedirs(thumb_upload_dir, exist_ok=True)

    try:
        if face and face.filename:
            face_path = os.path.join(thumb_upload_dir, f"face_{face.filename}")
            with open(face_path, "wb") as f:
                f.write(await face.read())

        if background and background.filename:
            bg_path = os.path.join(thumb_upload_dir, f"bg_{background.filename}")
            with open(bg_path, "wb") as f:
                f.write(await background.read())

        # Get video context from session (transcript summary from analysis step)
        video_context = ""
        if session_id in thumbnail_sessions:
            video_context = thumbnail_sessions[session_id].get("context", "")

        # Run generation in thread pool
        loop = asyncio.get_event_loop()
        thumbnails = await loop.run_in_executor(
            None,
            generate_thumbnail,
            ai_config,
            title,
            session_id,
            face_path,
            bg_path,
            extra_prompt,
            count,
            video_context
        )

        if not thumbnails:
            raise HTTPException(status_code=500, detail="Thumbnail generation failed. Please check your AI provider configuration.")

        if session_id not in thumbnail_sessions:
            thumbnail_sessions[session_id] = {}
        thumbnail_sessions[session_id].update({
            "titles": thumbnail_sessions[session_id].get("titles", [title]),
            "generated_thumbnails": thumbnails,
            "selected_thumbnail": thumbnail_sessions[session_id].get("selected_thumbnail", thumbnails[0] if thumbnails else None),
        })

        return {"thumbnails": thumbnails}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Thumbnail Generate Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ThumbnailDescribeRequest(BaseModel):
    session_id: str
    title: str


class ThumbnailProjectSaveRequest(BaseModel):
    session_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    selected_thumbnail: Optional[str] = None
    thumbnail_urls: List[str] = []


class ThumbnailProjectUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    selected_thumbnail: Optional[str] = None


class ThumbnailProjectFileUpdateRequest(BaseModel):
    content: str


@app.post("/api/thumbnail/save")
async def thumbnail_save(req: ThumbnailProjectSaveRequest):
    """Save the full thumbnail project bundle to MinIO/S3 as a browsable project folder."""
    if req.session_id not in thumbnail_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        raise HTTPException(status_code=400, detail="Missing AWS_S3_BUCKET or AWS_S3_PUBLIC_BUCKET")
    if not os.environ.get("AWS_ACCESS_KEY_ID") or not os.environ.get("AWS_SECRET_ACCESS_KEY"):
        raise HTTPException(status_code=400, detail="Missing AWS S3 credentials")

    session = thumbnail_sessions[req.session_id]
    thumbnail_urls = req.thumbnail_urls or session.get("generated_thumbnails", [])
    if not thumbnail_urls:
        raise HTTPException(status_code=400, detail="No generated thumbnails available to save")

    final_title = req.title or (session.get("titles", [""])[0] if session.get("titles") else "")
    result = upload_thumbnail_project(
        req.session_id,
        session,
        title=final_title,
        description=req.description if req.description is not None else session.get("description", ""),
        thumbnail_urls=thumbnail_urls,
        selected_thumbnail=req.selected_thumbnail or session.get("selected_thumbnail"),
    )

    if not result:
        raise HTTPException(status_code=500, detail="Failed to upload the project bundle to MinIO/S3")

    session["saved_project"] = result
    return result


@app.get("/api/thumbnail/projects")
async def thumbnail_projects(limit: int = Query(24, ge=1, le=100)):
    """List saved thumbnail projects and their files from S3/MinIO."""
    projects = list_thumbnail_projects(limit=limit)
    return {"projects": projects}


def _group_clip_history(all_clips: List[Dict], limit: int):
    grouped = {}

    for clip in all_clips:
        job_id = clip.get("job_id") or "unknown"
        entry = grouped.setdefault(job_id, {
            "job_id": job_id,
            "title": clip.get("title") or job_id,
            "description": clip.get("tiktok_desc") or clip.get("insta_desc") or "",
            "created_at": clip.get("created_at"),
            "clip_count": 0,
            "total_duration": 0,
            "preview_url": clip.get("url") or "",
            "preview_image_url": clip.get("preview_image_url") or clip.get("thumbnail_url") or clip.get("poster_url") or clip.get("image_url") or clip.get("actor_url") or "",
            "clips": [],
        })

        entry["clips"].append(clip)
        entry["clip_count"] += 1
        entry["total_duration"] += float(clip.get("duration") or 0)

        if not entry.get("title"):
            entry["title"] = clip.get("title") or job_id
        if not entry.get("description"):
            entry["description"] = clip.get("tiktok_desc") or clip.get("insta_desc") or ""
        if not entry.get("created_at"):
            entry["created_at"] = clip.get("created_at")
        if not entry.get("preview_url") and clip.get("url"):
            entry["preview_url"] = clip.get("url")
        if not entry.get("preview_image_url"):
            entry["preview_image_url"] = (
                clip.get("preview_image_url")
                or clip.get("thumbnail_url")
                or clip.get("poster_url")
                or clip.get("image_url")
                or clip.get("actor_url")
                or ""
            )

    projects = list(grouped.values())
    for entry in projects:
        entry["clips"].sort(key=lambda clip: int(clip.get("index") or 0))
        entry["clip_count"] = len(entry["clips"])
        if not entry.get("preview_url") and entry["clips"]:
            entry["preview_url"] = entry["clips"][0].get("url") or ""
        if not entry.get("preview_image_url") and entry["clips"]:
            first_clip = entry["clips"][0]
            entry["preview_image_url"] = (
                first_clip.get("preview_image_url")
                or first_clip.get("thumbnail_url")
                or first_clip.get("poster_url")
                or first_clip.get("image_url")
                or first_clip.get("actor_url")
                or ""
            )
        if entry["clips"]:
            entry["title"] = entry["title"] or entry["clips"][0].get("title") or entry["job_id"]
            entry["description"] = entry["description"] or entry["clips"][0].get("tiktok_desc") or entry["clips"][0].get("insta_desc") or ""

    projects.sort(key=lambda project: project.get("created_at") or "", reverse=True)
    return projects[:limit] if limit else projects


@app.get("/api/projects/history")
async def list_project_history(limit: int = Query(48, ge=1, le=100), refresh: bool = Query(True)):
    """List historical clip-generation jobs grouped by job ID."""
    try:
        loop = asyncio.get_running_loop()
        all_clips = await loop.run_in_executor(None, list_all_clips, None, 0, refresh)
        projects = _group_clip_history(all_clips, limit)
        return {"projects": projects, "total": len(projects)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/projects/{job_id}")
async def delete_project(job_id: str):
    """Delete a historical project and all its artifacts (local and S3)."""
    try:
        # 1. Delete Local Artifacts
        job_output_dir = os.path.join(OUTPUT_DIR, job_id)
        if os.path.exists(job_output_dir):
            shutil.rmtree(job_output_dir, ignore_errors=True)
        
        # 2. Delete S3 Artifacts
        loop = asyncio.get_running_loop()
        s3_deleted = await loop.run_in_executor(None, delete_job_artifacts, job_id)
        
        # 3. Remove from in-memory state
        if job_id in jobs:
            del jobs[job_id]
            
        return {"success": True, "job_id": job_id, "s3_deleted_count": s3_deleted}
    except Exception as e:
        print(f"❌ Project Deletion Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/thumbnail/projects/migrate-legacy")
async def thumbnail_projects_migrate_legacy(
    dry_run: bool = Query(False, description="Preview the migration without writing to MinIO"),
    delete_source: bool = Query(True, description="Delete the legacy root folder after copying"),
):
    """Move legacy bucket-root thumbnail folders into the browsable project prefix."""
    result = migrate_legacy_thumbnail_projects(dry_run=dry_run, delete_source=delete_source)
    return result


@app.patch("/api/thumbnail/projects/{session_id}/{project_slug}")
async def thumbnail_project_update(
    session_id: str,
    project_slug: str,
    req: ThumbnailProjectUpdateRequest,
):
    """Update project metadata such as title, description, or selected thumbnail."""
    result = update_thumbnail_project(
        session_id,
        project_slug,
        title=req.title,
        description=req.description,
        selected_thumbnail=req.selected_thumbnail,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Project not found or update failed")
    return result


@app.delete("/api/thumbnail/projects/{session_id}/{project_slug}")
async def thumbnail_project_delete(session_id: str, project_slug: str):
    """Delete a saved thumbnail project and all of its files."""
    result = delete_thumbnail_project(session_id, project_slug)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found or delete failed")
    return result


@app.patch("/api/thumbnail/projects/{session_id}/{project_slug}/files/{file_path:path}")
async def thumbnail_project_file_update(
    session_id: str,
    project_slug: str,
    file_path: str,
    req: ThumbnailProjectFileUpdateRequest,
):
    """Edit a text-based file inside a thumbnail project."""
    result = update_thumbnail_project_file(session_id, project_slug, file_path, req.content)
    if not result:
        raise HTTPException(status_code=400, detail="File update failed")
    return result


@app.delete("/api/thumbnail/projects/{session_id}/{project_slug}/files/{file_path:path}")
async def thumbnail_project_file_delete(
    session_id: str,
    project_slug: str,
    file_path: str,
):
    """Delete a file inside a thumbnail project."""
    result = delete_thumbnail_project_file(session_id, project_slug, file_path)
    if not result:
        raise HTTPException(status_code=404, detail="File not found or delete failed")
    return result

@app.post("/api/thumbnail/describe")
async def thumbnail_describe(
    req: ThumbnailDescribeRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    """Generate a YouTube description with chapters from the transcript."""
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
    )
    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing X-Gemini-Key header")

    if req.session_id not in thumbnail_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = thumbnail_sessions[req.session_id]
    segments = session.get("transcript_segments", [])
    if not segments:
        raise HTTPException(status_code=400, detail="No transcript segments available. Please analyze a video first.")

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            generate_youtube_description,
            ai_config,
            req.title,
            segments,
            session.get("language", "en"),
            session.get("video_duration", 0)
        )
        description = result.get("description", "")
        session["description"] = description
        return {"description": description}

    except Exception as e:
        print(f"❌ Thumbnail Describe Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/thumbnail/publish")
async def thumbnail_publish(
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(...),
    thumbnail_url: str = Form(...),
    api_key: str = Form(...),
    user_id: str = Form(...),
):
    """Kick off a background upload to YouTube via Upload-Post and return immediately."""
    if session_id not in thumbnail_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = thumbnail_sessions[session_id]
    video_path = session.get("video_path")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Original video file not found")

    # Resolve thumbnail path from URL
    thumb_relative = thumbnail_url.lstrip("/")
    if thumb_relative.startswith("thumbnails/"):
        thumb_path = os.path.join(OUTPUT_DIR, thumb_relative)
    else:
        thumb_path = os.path.join(THUMBNAILS_DIR, thumb_relative)

    if not os.path.exists(thumb_path):
        raise HTTPException(status_code=404, detail=f"Thumbnail file not found: {thumb_path}")

    # Generate a unique ID for this publish job so the frontend can poll
    publish_id = str(uuid.uuid4())
    publish_jobs[publish_id] = {"status": "uploading", "result": None, "error": None}

    def do_upload():
        """Runs in a thread via BackgroundTasks — does the actual multipart upload."""
        try:
            upload_url = "https://api.upload-post.com/api/upload"
            headers = {"Authorization": f"Apikey {api_key}"}
            data_payload = {
                "user": user_id,
                "platform[]": ["youtube"],
                "title": title,          # required base field (fallback)
                "async_upload": "true",
                "youtube_title": title,
                "youtube_description": description,
                "privacyStatus": "public",
            }
            video_filename = os.path.basename(video_path)
            thumb_filename = os.path.basename(thumb_path)

            print(f"📡 [Thumbnail] Publishing to YouTube via Upload-Post... (publish_id={publish_id})")
            with open(video_path, "rb") as vf, open(thumb_path, "rb") as tf:
                files = {
                    "video": (video_filename, vf.read(), "video/mp4"),
                    "thumbnail": (thumb_filename, tf.read(), "image/jpeg"),
                }

            # Use a long timeout — video uploads can take several minutes
            with httpx.Client(timeout=600.0) as client:
                response = client.post(upload_url, headers=headers, data=data_payload, files=files)

            if response.status_code not in [200, 201, 202]:
                err = f"Upload-Post API Error ({response.status_code}): {response.text}"
                print(f"❌ {err}")
                publish_jobs[publish_id]["status"] = "failed"
                publish_jobs[publish_id]["error"] = err
            else:
                print(f"✅ [Thumbnail] Published successfully (publish_id={publish_id})")
                publish_jobs[publish_id]["status"] = "done"
                publish_jobs[publish_id]["result"] = response.json()

        except Exception as e:
            err = str(e)
            print(f"❌ Thumbnail Publish Background Error: {err}")
            publish_jobs[publish_id]["status"] = "failed"
            publish_jobs[publish_id]["error"] = err

    background_tasks.add_task(do_upload)
    return {"publish_id": publish_id, "status": "uploading"}


@app.get("/api/thumbnail/publish/status/{publish_id}")
async def thumbnail_publish_status(publish_id: str):
    """Poll the status of a background publish job."""
    if publish_id not in publish_jobs:
        raise HTTPException(status_code=404, detail="Publish job not found")
    return publish_jobs[publish_id]


@app.get("/api/projects/clips/{session_id}")
async def list_project_clips_endpoint(session_id: str, refresh: bool = Query(True)):
    """List all clips associated with a session ID/job ID from S3."""
    try:
        loop = asyncio.get_running_loop()
        # Fetch normal clipping results
        all_clips = await loop.run_in_executor(None, list_all_clips, None, 0, refresh)
        # Filter by job_id (which matches the project session_id)
        project_clips = [c for c in all_clips if c.get('job_id') == session_id]
        return {"clips": project_clips, "total": len(project_clips)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# @app.get("/api/gallery/clips")
# async def get_gallery_clips(limit: int = 20, offset: int = 0, refresh: bool = False):
#     """
#     Fetch clips from S3 for the gallery with pagination.
#
#     Args:
#         limit: Number of clips to return (default 20, max 100)
#         offset: Starting position for pagination
#         refresh: Force refresh cache
#     """
#     try:
#         # Clamp limit to reasonable values
#         limit = min(max(1, limit), 100)
#
#         # Get clips (uses cache internally)
#         all_clips = list_all_clips(limit=limit + offset, force_refresh=refresh)
#
#         # Apply offset for pagination
#         clips = all_clips[offset:offset + limit]
#
#         return {
#             "clips": clips,
#             "total": len(all_clips),
#             "limit": limit,
#             "offset": offset,
#             "has_more": len(all_clips) > offset + limit
#         }
#     except Exception as e:
#         print(f"❌ Gallery Error: {e}")
#         raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════
# SaaSShorts: AI UGC Video Generator for SaaS Products
# ═══════════════════════════════════════════════════════════════════════

from saasshorts import (
    scrape_website,
    research_saas_online,
    analyze_saas,
    generate_scripts,
    generate_full_video,
    generate_actor_images,
    get_elevenlabs_voices,
    DEFAULT_VOICES,
)

# State for SaaSShorts jobs (separate from video processing jobs)
saas_jobs: Dict[str, Dict] = {}


class SaaSAnalyzeRequest(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None  # Manual product/business description
    num_scripts: int = 3
    style: str = "ugc"
    language: str = "en"
    actor_gender: str = "female"


@app.post("/api/saasshorts/analyze")
async def saasshorts_analyze(
    req: SaaSAnalyzeRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_ai_provider: Optional[str] = Header(None, alias="X-AI-Provider"),
    x_ai_api_key: Optional[str] = Header(None, alias="X-AI-Api-Key"),
    x_ai_base_url: Optional[str] = Header(None, alias="X-AI-Base-Url"),
    x_ai_model: Optional[str] = Header(None, alias="X-AI-Model"),
    x_ai_vision_model: Optional[str] = Header(None, alias="X-AI-Vision-Model"),
    x_ai_image_model: Optional[str] = Header(None, alias="X-AI-Image-Model"),
):
    """Analyze a URL or manual description and generate video scripts."""
    ai_config = build_ai_config(
        provider=x_ai_provider or ("gemini" if (x_gemini_key or os.environ.get("GEMINI_API_KEY")) else None),
        api_key=x_ai_api_key or x_gemini_key,
        base_url=x_ai_base_url,
        model=x_ai_model,
        vision_model=x_ai_vision_model,
        image_model=x_ai_image_model,
    )
    if ai_config.is_gemini() and not ai_config.api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API Key")

    if not req.url and not req.description:
        raise HTTPException(status_code=400, detail="Provide a URL or a product description")

    try:
        loop = asyncio.get_event_loop()

        def run_analysis():
            web_research = None

            if req.url and req.url.strip():
                # URL provided: full scrape + research pipeline
                scraped = scrape_website(req.url)
                web_research = research_saas_online(req.url, ai_config, scraped_data=scraped)
                analysis = analyze_saas(scraped, ai_config, web_research=web_research)
            else:
                # Manual description: build analysis from description
                analysis = {
                    "product_name": req.description.split(",")[0].strip()[:60] if req.description else "Product",
                    "description": req.description,
                    "value_proposition": req.description,
                    "target_audience": "general audience",
                    "key_features": [req.description],
                    "pain_points": [],
                    "tone": "casual and authentic",
                }

            scripts = generate_scripts(analysis, ai_config, req.num_scripts, req.style, req.language, req.actor_gender)
            return {
                "analysis": analysis,
                "scripts": scripts,
                "web_research": web_research,
            }

        result = await loop.run_in_executor(None, run_analysis)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SaaSActorRequest(BaseModel):
    actor_description: str
    num_options: int = 3
    product_description: Optional[str] = None


@app.post("/api/saasshorts/actor-upload")
async def saasshorts_actor_upload(file: UploadFile = File(...)):
    """Upload a custom actor image (stored locally only, not S3)."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    try:
        content = await file.read()

        # Validate minimum size
        if len(content) < 1000:
            raise HTTPException(status_code=400, detail="File too small to be a valid image")

        upload_id = uuid.uuid4().hex[:8]
        upload_dir = os.path.join(OUTPUT_DIR, "actor_uploads")
        os.makedirs(upload_dir, exist_ok=True)
        filename = f"custom_{upload_id}.png"
        file_path = os.path.join(upload_dir, filename)

        with open(file_path, "wb") as f:
            f.write(content)

        return {"url": f"/videos/actor_uploads/{filename}"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/saasshorts/actor-options")
async def saasshorts_actor_options(
    req: SaaSActorRequest,
    x_fal_key: Optional[str] = Header(None, alias="X-Fal-Key"),
):
    """Generate multiple actor image options for the user to choose from."""
    fal_key = x_fal_key
    if not fal_key:
        raise HTTPException(status_code=400, detail="Missing fal.ai API Key")

    try:
        job_id = str(uuid.uuid4())
        out_dir = os.path.join(OUTPUT_DIR, f"saas_actors_{job_id}")
        os.makedirs(out_dir, exist_ok=True)

        loop = asyncio.get_running_loop()
        import functools
        paths = await loop.run_in_executor(
            None,
            functools.partial(
                generate_actor_images,
                req.actor_description, fal_key, out_dir, "actor", req.num_options,
                product_description=req.product_description,
            ),
        )

        # Upload each actor image to public S3 with description
        desc = req.actor_description
        if req.product_description:
            desc += f" (holding {req.product_description})"
        urls = []
        for p in paths:
            s3_url = upload_actor_to_s3(p, description=desc)
            if s3_url:
                urls.append(s3_url)
            else:
                # Fallback to local URL if S3 fails
                urls.append(f"/videos/saas_actors_{job_id}/{os.path.basename(p)}")

        return {"images": urls}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/saasshorts/gallery")
async def saasshorts_video_gallery(limit: int = 50):
    """List all UGC videos from the public gallery."""
    try:
        loop = asyncio.get_running_loop()
        videos = await loop.run_in_executor(None, list_video_gallery, limit)
        return {"videos": videos, "total": len(videos)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SaaSPostRequest(BaseModel):
    job_id: str
    api_key: str
    user_id: str
    platforms: List[str]
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_date: Optional[str] = None
    timezone: Optional[str] = "UTC"


@app.post("/api/saasshorts/post")
async def saasshorts_post_to_socials(req: SaaSPostRequest):
    """Post an AI Shorts video to social media via Upload-Post."""
    if req.job_id not in saas_jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = saas_jobs[req.job_id]
    result = job.get("result")
    if not result or not result.get("video_url"):
        raise HTTPException(status_code=400, detail="No video available for this job")

    try:
        # Resolve video file path
        video_url = result["video_url"]  # e.g. /videos/saas_xxx/slug_final.mp4
        rel_path = video_url.replace("/videos/", "")
        file_path = os.path.join(OUTPUT_DIR, rel_path)

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"Video file not found")

        script = result.get("script", {})
        final_title = req.title or script.get("title", "AI Short")
        final_description = req.description or script.get("caption", "")
        if not final_description:
            final_description = script.get("full_narration", "Check this out!")

        url = "https://api.upload-post.com/api/upload"
        headers = {"Authorization": f"Apikey {req.api_key}"}

        data_payload = {
            "user": req.user_id,
            "title": final_title,
            "platform[]": req.platforms,
            "async_upload": "true",
        }

        if req.scheduled_date:
            data_payload["scheduled_date"] = req.scheduled_date
            if req.timezone:
                data_payload["timezone"] = req.timezone

        if "tiktok" in req.platforms:
            data_payload["tiktok_title"] = final_description
        if "instagram" in req.platforms:
            data_payload["instagram_title"] = final_description
            data_payload["media_type"] = "REELS"
        if "youtube" in req.platforms:
            data_payload["youtube_title"] = final_title
            data_payload["youtube_description"] = final_description
            data_payload["privacyStatus"] = "public"

        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            file_content = f.read()

        files = {"video": (filename, file_content, "video/mp4")}

        with httpx.Client(timeout=120.0) as client:
            print(f"📡 [AI Shorts] Sending to Upload-Post: {req.platforms}")
            response = client.post(url, headers=headers, data=data_payload, files=files)

        if response.status_code not in [200, 201, 202]:
            raise HTTPException(status_code=response.status_code, detail=f"Upload-Post Error: {response.text}")

        return response.json()

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [AI Shorts] Post Exception: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/gallery", response_class=HTMLResponse)
async def gallery_html_page():
    """SEO gallery page with all generated UGC videos."""
    import html as html_mod
    loop = asyncio.get_running_loop()
    videos = await loop.run_in_executor(None, list_video_gallery, 100)

    cards_html = ""
    ld_items = []
    for i, v in enumerate(videos):
        title = html_mod.escape(v.get("title", "Untitled"))
        video_url = v.get("video_url", "")
        actor_url = v.get("actor_url", "")
        video_id = v.get("video_id", "")
        duration = v.get("duration", 0)
        mode = v.get("video_mode", "")
        product = html_mod.escape(v.get("product_name", ""))
        caption = html_mod.escape(v.get("caption", "")[:120])

        mode_badge = '<span style="background:#22c55e;color:#000;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700">LOW COST</span>' if mode == "lowcost" else '<span style="background:#8b5cf6;color:#fff;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700">PREMIUM</span>'

        cards_html += f'''
        <a href="/video/{video_id}" style="text-decoration:none;color:inherit">
          <div style="background:#18181b;border-radius:16px;overflow:hidden;border:1px solid #27272a;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
            <div style="position:relative;aspect-ratio:9/16;background:#000">
              <video src="{video_url}" poster="{actor_url}" muted playsinline preload="metadata"
                     onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"
                     style="width:100%;height:100%;object-fit:cover"></video>
              <div style="position:absolute;top:8px;right:8px">{mode_badge}</div>
            </div>
            <div style="padding:12px">
              <h2 style="font-size:14px;font-weight:600;margin:0 0 4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{title}</h2>
              <p style="font-size:11px;color:#71717a;margin:0">{duration:.0f}s · {product}</p>
            </div>
          </div>
        </a>'''

        ld_items.append(f'{{"@type":"ListItem","position":{i+1},"url":"https://openshorts.app/video/{video_id}","name":"{title}"}}')

    ld_json = f'{{"@context":"https://schema.org","@type":"CollectionPage","name":"AI UGC Video Gallery","mainEntity":{{"@type":"ItemList","numberOfItems":{len(videos)},"itemListElement":[{",".join(ld_items)}]}}}}'

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI UGC Video Gallery | OpenShorts</title>
<meta name="description" content="Browse {len(videos)} AI-generated UGC marketing videos. Create viral TikTok and Instagram Reels for your SaaS product.">
<meta name="robots" content="index, follow">
<meta property="og:title" content="AI UGC Video Gallery | OpenShorts">
<meta property="og:type" content="website">
<meta property="og:description" content="Browse AI-generated UGC marketing videos for SaaS products.">
<script type="application/ld+json">{ld_json}</script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0a0a0c;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,sans-serif}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;padding:20px;max-width:1400px;margin:0 auto}}
nav{{padding:20px 40px;border-bottom:1px solid #27272a;display:flex;align-items:center;justify-content:space-between}}
h1{{font-size:28px;font-weight:700;padding:40px 20px 0;text-align:center}}
.subtitle{{text-align:center;color:#71717a;font-size:14px;padding:8px 20px 20px}}
.cta{{display:inline-block;background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px}}
</style>
</head>
<body>
<nav><strong style="font-size:18px">OpenShorts</strong><a href="/" class="cta">Create Your Video</a></nav>
<h1>AI-Generated UGC Videos</h1>
<p class="subtitle">{len(videos)} videos generated · Low Cost & Premium modes</p>
<div class="grid">{cards_html}</div>
<div style="text-align:center;padding:40px"><a href="/" class="cta">Create Your Own UGC Video</a></div>
</body></html>'''


@app.get("/video/{video_id}", response_class=HTMLResponse)
async def video_html_page(video_id: str):
    """SEO individual video page with og:video meta tags."""
    import html as html_mod
    loop = asyncio.get_running_loop()
    videos = await loop.run_in_executor(None, list_video_gallery, 200)
    meta = next((v for v in videos if v.get("video_id") == video_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Video not found")

    title = html_mod.escape(meta.get("title", "Untitled"))
    caption = html_mod.escape(meta.get("caption", ""))
    narration = html_mod.escape(meta.get("full_narration", ""))
    video_url = meta.get("video_url", "")
    actor_url = meta.get("actor_url", "")
    duration = meta.get("duration", 0)
    mode = meta.get("video_mode", "")
    product = html_mod.escape(meta.get("product_name", ""))
    product_url = html_mod.escape(meta.get("product_url", ""))
    language = meta.get("language", "en")
    hashtags = " ".join(meta.get("hashtags", []))
    cost = meta.get("cost_estimate", {}).get("total", 0)
    created = meta.get("created_at", "")
    actor_desc = html_mod.escape(meta.get("actor_description", ""))

    ld_json = f'{{"@context":"https://schema.org","@type":"VideoObject","name":"{title}","description":"{caption}","thumbnailUrl":"{actor_url}","contentUrl":"{video_url}","uploadDate":"{created}","duration":"PT{int(duration)}S","width":1080,"height":1920,"inLanguage":"{language}"}}'

    mode_label = "Low Cost" if mode == "lowcost" else "Premium"

    return f'''<!DOCTYPE html>
<html lang="{language}">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} - AI UGC Video | OpenShorts</title>
<meta name="description" content="{caption} {hashtags}">
<meta property="og:type" content="video.other">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{caption}">
<meta property="og:video" content="{video_url}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="1080">
<meta property="og:video:height" content="1920">
<meta property="og:image" content="{actor_url}">
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="{title}">
<meta name="twitter:image" content="{actor_url}">
<script type="application/ld+json">{ld_json}</script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0a0a0c;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,sans-serif}}
nav{{padding:20px 40px;border-bottom:1px solid #27272a;display:flex;align-items:center;gap:16px}}
nav a{{color:#a1a1aa;text-decoration:none;font-size:14px}}
.container{{max-width:1000px;margin:0 auto;padding:40px 20px;display:grid;grid-template-columns:1fr 1fr;gap:40px}}
@media(max-width:768px){{.container{{grid-template-columns:1fr}}}}
video{{width:100%;border-radius:16px;background:#000}}
h1{{font-size:22px;font-weight:700;margin-bottom:8px}}
.meta{{color:#71717a;font-size:13px;margin-bottom:20px}}
.section{{margin-bottom:20px}}
.section h2{{font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}}
.section p{{font-size:14px;line-height:1.6}}
.badge{{display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700}}
.cta{{display:inline-block;background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;margin-top:20px}}
</style>
</head>
<body>
<nav><strong>OpenShorts</strong><a href="/gallery">Gallery</a><span style="color:#3f3f46">›</span><span style="color:#e4e4e7;font-size:14px">{title}</span></nav>
<div class="container">
<div><video src="{video_url}" poster="{actor_url}" controls autoplay playsinline style="aspect-ratio:9/16;object-fit:cover"></video></div>
<div>
<h1>{title}</h1>
<p class="meta">{duration:.0f}s · {mode_label} · ${cost:.2f} · {product}</p>
<div class="section"><h2>Caption</h2><p>{caption}</p><p style="color:#8b5cf6;margin-top:4px">{hashtags}</p></div>
<div class="section"><h2>Script</h2><p>{narration}</p></div>
<div class="section"><h2>Actor</h2><p>{actor_desc}</p></div>
{f'<div class="section"><h2>Product</h2><p><a href="{product_url}" style="color:#8b5cf6" target="_blank">{product}</a></p></div>' if product_url else ''}
<a href="/gallery">← Back to Gallery</a>
<br><a href="/" class="cta">Create Your Own</a>
</div>
</div>
</body></html>'''


@app.get("/api/saasshorts/actor-gallery")
async def saasshorts_actor_gallery():
    """List all previously generated actor images from public S3."""
    try:
        loop = asyncio.get_running_loop()
        images = await loop.run_in_executor(None, list_actor_gallery)
        return {"images": images}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SaaSGenerateRequest(BaseModel):
    script: dict
    voice_id: Optional[str] = None
    actor_description: Optional[str] = None
    selected_actor_url: Optional[str] = None  # Pre-selected actor image URL
    retry_job_id: Optional[str] = None
    video_mode: str = "lowcost"  # "lowcost" or "premium"


@app.post("/api/saasshorts/generate")
async def saasshorts_generate(
    req: SaaSGenerateRequest,
    x_fal_key: Optional[str] = Header(None, alias="X-Fal-Key"),
    x_elevenlabs_key: Optional[str] = Header(None, alias="X-ElevenLabs-Key"),
):
    """Generate a SaaS UGC video from a script. Returns a job_id for polling."""
    fal_key = x_fal_key
    elevenlabs_key = x_elevenlabs_key

    if not fal_key:
        raise HTTPException(status_code=400, detail="Missing fal.ai API Key (X-Fal-Key header)")
    if not elevenlabs_key:
        raise HTTPException(status_code=400, detail="Missing ElevenLabs API Key (X-ElevenLabs-Key header)")

    # Support retry: reuse output_dir so cached assets (image, voice, head, broll) are kept
    reused = False
    if req.retry_job_id:
        # Check memory first, then disk
        old_dir = os.path.join(OUTPUT_DIR, f"saas_{req.retry_job_id}")
        if req.retry_job_id in saas_jobs:
            old_dir = saas_jobs[req.retry_job_id]["output_dir"]

        if os.path.isdir(old_dir):
            job_id = req.retry_job_id
            job_output_dir = old_dir
            reused = True
            # Clear the 0-byte final video so pipeline re-generates it
            for f in os.listdir(old_dir):
                fp = os.path.join(old_dir, f)
                if f.endswith("_final.mp4") and os.path.getsize(fp) == 0:
                    os.remove(fp)
            saas_jobs[job_id] = {
                "status": "processing",
                "logs": [f"Retrying job {job_id[:8]}... reusing cached assets from disk."],
                "result": None,
                "output_dir": job_output_dir,
            }

    if not reused:
        job_id = str(uuid.uuid4())
        job_output_dir = os.path.join(OUTPUT_DIR, f"saas_{job_id}")
        os.makedirs(job_output_dir, exist_ok=True)
        saas_jobs[job_id] = {
            "status": "processing",
            "logs": ["SaaSShorts job started."],
            "result": None,
            "output_dir": job_output_dir,
        }

    # If user selected a pre-generated actor, resolve it to a local path
    selected_actor_path = None
    if req.selected_actor_url:
        if req.selected_actor_url.startswith("http"):
            # Download from S3 public URL to job output dir
            import httpx
            try:
                actor_local = os.path.join(job_output_dir, "selected_actor.png")
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(req.selected_actor_url)
                    if resp.status_code == 200:
                        with open(actor_local, "wb") as f:
                            f.write(resp.content)
                        selected_actor_path = actor_local
            except Exception:
                pass
        else:
            src = os.path.join(OUTPUT_DIR, req.selected_actor_url.replace("/videos/", ""))
            if os.path.exists(src):
                selected_actor_path = src

    config = {
        "fal_key": fal_key,
        "elevenlabs_key": elevenlabs_key,
        "voice_id": req.voice_id or "21m00Tcm4TlvDq8ikWAM",
        "actor_description": req.actor_description,
        "selected_actor_path": selected_actor_path,
        "video_mode": req.video_mode,
    }

    async def run_generation():
        await concurrency_semaphore.acquire()
        try:
            loop = asyncio.get_running_loop()

            def log_msg(msg):
                print(f"[SaaSShorts Job {job_id[:8]}] {msg}")
                if job_id in saas_jobs:
                    saas_jobs[job_id]["logs"].append(msg)

            def run():
                return generate_full_video(req.script, config, job_output_dir, log_msg)

            result = await loop.run_in_executor(None, run)

            if job_id in saas_jobs:
                video_filename = result["video_filename"]
                saas_jobs[job_id]["status"] = "completed"
                saas_jobs[job_id]["result"] = {
                    "video_url": f"/videos/saas_{job_id}/{video_filename}",
                    "video_filename": video_filename,
                    "duration": result.get("duration", 0),
                    "cost_estimate": result.get("cost_estimate", {}),
                    "script": req.script,
                }
                saas_jobs[job_id]["logs"].append("Video generation completed!")

                # Upload to public gallery (non-blocking)
                try:
                    gallery_meta = {
                        "title": req.script.get("title", "Untitled"),
                        "hook_text": req.script.get("hook_text", ""),
                        "caption": req.script.get("caption", ""),
                        "hashtags": req.script.get("hashtags", []),
                        "full_narration": req.script.get("full_narration", ""),
                        "actor_description": req.script.get("actor_description", ""),
                        "style": req.script.get("style", "ugc"),
                        "language": req.script.get("language", "en"),
                        "duration": result.get("duration", 0),
                        "video_mode": req.video_mode,
                        "product_name": req.script.get("_product_name", ""),
                        "product_url": req.script.get("_product_url", ""),
                        "segments": req.script.get("segments", []),
                        "cost_estimate": result.get("cost_estimate", {}),
                    }
                    gallery_result = upload_video_to_gallery(
                        video_path=result["video_path"],
                        actor_image_path=result.get("actor_image", ""),
                        metadata=gallery_meta,
                        video_id=job_id[:8],
                    )
                    if gallery_result:
                        saas_jobs[job_id]["result"]["gallery_video_id"] = gallery_result["video_id"]
                        log_msg("📤 Uploaded to public gallery.")
                except Exception as gallery_err:
                    log_msg(f"⚠️ Gallery upload skipped: {gallery_err}")

        except Exception as e:
            print(f"[SaaSShorts] ❌ Job {job_id} failed: {e}")
            if job_id in saas_jobs:
                saas_jobs[job_id]["status"] = "failed"
                saas_jobs[job_id]["logs"].append(f"Error: {str(e)}")
        finally:
            concurrency_semaphore.release()

    asyncio.create_task(run_generation())

    return {"job_id": job_id, "status": "processing"}


@app.get("/api/saasshorts/status/{job_id}")
async def saasshorts_status(job_id: str):
    """Poll SaaSShorts job status."""
    if job_id not in saas_jobs:
        raise HTTPException(status_code=404, detail="SaaSShorts job not found")

    job = saas_jobs[job_id]
    return {
        "status": job["status"],
        "logs": job["logs"],
        "result": job.get("result"),
    }


@app.get("/api/saasshorts/voices")
async def saasshorts_voices(
    x_elevenlabs_key: Optional[str] = Header(None, alias="X-ElevenLabs-Key"),
):
    """List available ElevenLabs voices."""
    if x_elevenlabs_key:
        try:
            loop = asyncio.get_event_loop()
            voices = await loop.run_in_executor(
                None, get_elevenlabs_voices, x_elevenlabs_key
            )
            if voices:
                return {"voices": voices, "source": "elevenlabs"}
        except Exception:
            pass

    # Fallback to default voices
    return {
        "voices": [
            {"voice_id": vid, "name": name, "category": "default"}
            for name, vid in DEFAULT_VOICES.items()
        ],
        "source": "defaults",
    }
