# OpenShorts.app

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open Source](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)](https://opensource.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![GitHub stars](https://img.shields.io/github/stars/mutonby/openshorts?style=social)](https://github.com/mutonby/openshorts)
[![Last Commit](https://img.shields.io/github/last-commit/mutonby/openshorts)](https://github.com/mutonby/openshorts/commits/main)

**Free and open source video clipping platform.** Turn long-form videos into short clips with AI moment detection, vertical reframing, subtitles, optional dubbing, and social publishing. Self-host with Docker.

https://github.com/user-attachments/assets/b45fa983-16b4-48b5-ac5b-a267836b9ad9

## Development

This repository includes a commit hook that rejects messages outside the
Conventional Commits format. Enable it once per checkout with:

```bash
git config core.hooksPath .githooks
```

Accepted examples include `feat: add captions`, `fix(editor): prevent a crash`,
and `refactor!: change the rendering API`.

Python application modules live in the `openshorts/` package, grouped by area:
analysis, AI, media, observability, rendering, runtime, storage, subtitles,
integrations, and workflows. `main.py` and `python_worker.py` remain at the root
because the Go control plane launches them directly. Python developer utilities
live in `scripts/python/`.


### Video Tutorial: How it works
[![OpenShorts Tutorial](https://img.youtube.com/vi/xlyjD1qCaX0/maxresdefault.jpg)](https://www.youtube.com/watch?v=xlyjD1qCaX0 "Click to watch the video on YouTube")

*Click the image above to watch the full walkthrough.*

---

## Clip Generation

### 1. Clip Generator
Turn your long-form videos — podcasts, webinars, livestreams, vlogs, interviews — into viral-ready 9:16 shorts for TikTok, Instagram Reels, and YouTube Shorts.

![Clip Results](screenshots/clip-results.png)

## Key Features

### Clip Generator
- **Viral Moment Detection**: Google Gemini 3.0 Flash analyzes transcripts and scene boundaries to detect 3-15 high-potential moments
- **Smart 9:16 Cropping**: Dual-mode AI reframing — TRACK mode (MediaPipe + YOLOv8 face tracking) and GENERAL mode (blurred background)
- **Auto Subtitles**: remote transcription with word-level timestamps, styled and burned into clips
- **AI Voice Dubbing**: ElevenLabs integration for 30+ languages with voice cloning
- **Hook Text Overlays**: AI-generated attention-grabbing text overlays
- **AI Video Effects**: Gemini-generated FFmpeg filters for professional effects

### Social Auto-Publishing
- **One-click posting** to TikTok, Instagram Reels, and YouTube Shorts simultaneously
- **Schedule uploads** for any date and time — plan your content calendar and let OpenShorts publish automatically
- **Multi-platform distribution** — publish to all your social networks at once from a single interface
- Upload-Post integration with async uploads

### Infrastructure
- S3 cloud backup for generated clips
- Go control plane serves API and media routes; the Python process is used only as an internal ML/media worker
- Async job queue with configurable concurrency

The remaining Python entrypoints and their supporting modules are tracked as
transitional legacy code in [`LEGACY.md`](LEGACY.md). They remain in the image
only because the Go control plane still launches the media/AI worker.

---

## Who Is This For?

- **Content creators, podcasters, and educators** — repurpose long-form videos into short clips.
- **Social media teams** — prepare and publish clips across platforms.
- **Developers** — self-host and customize the workflow.

---

## OpenShorts vs Competitors

| Feature | OpenShorts | Opus Clip | CapCut | Vizard | Klap | Descript |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Price** | **Free** | $15-29/mo | $8/mo | $15-20/mo | $23-63/mo | $24-65/mo |
| **Self-hosted** | **Yes** | No | No | No | No | No |
| **Open source** | **Yes** | No | No | No | No | No |
| **Watermark** | **Never** | Free tier | Some | Free tier | Free tier | Free tier |
| **Upload limits** | **None** | 10-30GB | Credit-based | 60min-10hr | 10-100 vids/mo | 60min-40hr |
| **AI clip detection** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Smart 9:16 reframing** | Yes | Yes | Yes | Yes | Yes | No |
| **Auto subtitles** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Voice dubbing (30+ langs)** | Yes | No | Pro only | No | Pro only | Business only |
| **AI video effects** | Yes | No | Yes | No | No | No |
| **Hook text overlays** | Yes | No | No | No | No | No |
| **Social auto-publishing** | Yes | Pro only | TikTok only | Paid only | Paid only | No |
| **Schedule uploads** | Yes | Pro only | No | Paid only | Paid only | No |
| **Data privacy** | **Your server** | Their cloud | Their cloud | Their cloud | Their cloud | Their cloud |

---

## How Much Does It Cost?

OpenShorts is free. You only pay for the AI APIs you use — and most have generous free tiers:

| Service | Free Tier | Paid Cost | Used For |
|---------|-----------|-----------|----------|
| **Google Gemini** | Free trial with generous limits | < $0.01 per 10-min video | Clip analysis and video effects |
| **OpenAI Codex (ChatGPT)** | Included with eligible ChatGPT plans | Plan-dependent | AI clip detection and generation through your ChatGPT subscription |
| **ElevenLabs** | Free tier available | Pay-per-use | Voiceover, voice dubbing |
| **Upload-Post** | **10 free uploads/month** to all networks (no credit card) | Pay-per-use | Auto-publishing to TikTok, Instagram, YouTube |
| **AWS S3** | Optional | ~$0.023/GB | Cloud backup for clips |

**Bottom line:** You can clip videos for practically free with Gemini, and publish 10 videos/month to all social networks at zero cost with Upload-Post.

---

## Requirements

- **OpenAI Codex (ChatGPT)** — optional alternative to a Gemini API key; connect it from Dashboard **Settings** with the device-code flow and no OpenAI API key.

- **Docker & Docker Compose**
- **Google Gemini API Key** ([Free — get it here](https://aistudio.google.com/app/apikey)) — required for Gemini AI features; use OpenAI Codex as an alternative.
- **ElevenLabs API Key** ([Free tier](https://elevenlabs.io)) — optional for voice dubbing
- **Upload-Post API Key** ([free tier](https://upload-post.com)) — required for direct social posting

---

## Getting Started

### 1. Clone
```bash
git clone https://github.com/your-username/OpenShorts.git
cd OpenShorts
```

### 2. Configure (optional)
```bash
cp .env.example .env
# Edit .env for app defaults, and use .env.local / .env.devel / .env.quality
# if you want profile-specific deploy helper settings.
```

### 3. Launch
```bash
docker compose up --build
```

### 4. Open Dashboard
Navigate to **`http://localhost:18575`**

1. Go to **Settings** and choose Gemini, LM Studio, or **OpenAI Codex (ChatGPT)**. Codex connects through ChatGPT device authorization and does not use an OpenAI API key.
2. **Clip Generator**: Upload a long-form video to generate viral shorts
3. **Local Editor**: refine generated clips and add edits
4. **Performance**: review processing activity and publishing

### SeaweedFS S3 storage
The Docker Compose deployment uses the migrated SeaweedFS S3-compatible endpoint
`http://seaweedfs-s3.192.168.50.2.nip.io:32380` and the `openshorts-media` bucket for
generated media and source-object browsing. The old Kubernetes OpenShorts
runtime has been removed; the files under `k8s/` remain only as legacy
deployment references.

---

## Technical Pipeline

### Clip Generator
1. **Ingest** — Local video upload (or self-hosted URL ingest via yt-dlp)
2. **Transcribe** — configured remote transcription with word-level timestamps
3. **Detect** — PySceneDetect for scene boundaries
4. **Analyze** — Gemini identifies 3-15 viral moments (15-60s each)
5. **Extract** — FFmpeg precise clip cutting
6. **Reframe** — AI vertical cropping with subject tracking
7. **Effects** — Subtitles, hooks, AI video effects
8. **Publish** — S3 backup + Upload-Post social distribution

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go control plane, Python JSON-lines ML/media worker, Codex CLI, google-genai, ultralytics (YOLOv8), mediapipe, opencv-python, yt-dlp, FFmpeg, httpx |
| Frontend | React 18, Vite 4, Tailwind CSS 3.4 |
| AI APIs | Configured AI provider, optional ElevenLabs dubbing |
| Infrastructure | Docker + Docker Compose, AWS S3 |
| Publishing | Upload-Post API (TikTok, Instagram, YouTube) |

---

## Environment Variables

**Server-side (.env):**
| Variable | Description |
|----------|------------|
| `AWS_ACCESS_KEY_ID` | S3 access key, including SeaweedFS |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key, including SeaweedFS |
| `AWS_REGION` | Region label used for S3 signing and fallback URLs |
| `AWS_S3_BUCKET` | Private bucket for clip backup |
| `AWS_S3_PUBLIC_BUCKET` | Optional public media bucket |
| `AWS_S3_ENDPOINT_URL` | Custom S3 endpoint, such as SeaweedFS |
| `AWS_S3_PUBLIC_URL_BASE` | Browser-facing base URL for public media links |
| `AWS_S3_PUBLIC_ENDPOINT_URL` | Endpoint used to generate presigned URLs for public access |
| `AWS_S3_FORCE_PATH_STYLE` | Force path-style URLs, recommended for SeaweedFS |
| `MINIO_DOWNLOAD_MAX_CONCURRENCY` | Parallel multipart download workers (default: 16) |
| `MINIO_DOWNLOAD_MULTIPART_THRESHOLD_MB` | File size at which multipart downloading starts (default: 32 MB) |
| `MINIO_DOWNLOAD_MULTIPART_CHUNKSIZE_MB` | Size of each multipart download chunk (default: 64 MB) |
| `MAX_CONCURRENT_JOBS` | Concurrent processing limit (default: 5) |
| `OPENSHORTS_CODEX_AUTH_FILE` | Optional path for the installation-scoped Codex credential file |
| `CODEX_MODEL` | Optional Codex model override (default: `gpt-6-luna`) |
| `OPENAI_CLIP_ANALYSIS_MODE` | `auto` uses complete-file analysis when available; `file` requires it; `legacy` forces lossless windows |
| `OPENAI_API_KEY` | Optional server-only key for the public OpenAI Files API; not required for connected Codex |
| `OPENAI_ANALYZE_MODEL` | Optional model override for complete-file analysis |
| `OPENAI_FILE_ANALYSIS_MAX_TOKENS` | Maximum estimated complete-artifact size (default: `100000`) |

**Client-side (encrypted in localStorage):**
| Key | Description |
|-----|------------|
| `GEMINI_API_KEY` | Google Gemini — required |
| `ai_provider_v1` | Selected provider; use `openai-codex` for a ChatGPT subscription |
| `ELEVENLABS_API_KEY` | ElevenLabs — optional for voice dubbing |
| `UPLOAD_POST_API_KEY` | Upload-Post — required, for social posting |

---

## Security & Performance

- **Non-Root Execution**: Containers run as dedicated `appuser`
- **Concurrency Control**: Semaphore-based job queue (`MAX_CONCURRENT_JOBS`)
- **Auto-Cleanup**: Automatic purging of old jobs (1h retention)
- **Encrypted Keys**: API keys encrypted client-side, never stored server-side
- **Codex credentials**: ChatGPT device authorization tokens stay in the backend's protected, git-ignored credential file and are never returned to the browser
- **Complete timeline review**: Connected Codex runs the full timestamped JSONL artifact through the read-only Codex CLI; the worker does not split it into windows unless complete-file analysis is unavailable
- **Upload Validation**: Image uploads validated for format and minimum size
- **File Limits**: 2GB upload limit protection

---

## Social Media Setup (Upload-Post)

1. **Register**: [app.upload-post.com/login](https://app.upload-post.com/login)
2. **Create Profile**: Go to [Manage Users](https://app.upload-post.com/manage-users)
3. **Connect Accounts**: Link TikTok, Instagram, and/or YouTube
4. **Get API Key**: Navigate to [API Keys](https://app.upload-post.com/api-keys)
5. **Use in OpenShorts**: Paste the key in Settings

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=mutonby/openshorts&type=Date)](https://star-history.com/#mutonby/openshorts&Date)

## Contributions

Contributions are welcome! Whether it's adding new AI models, improving the lip-sync pipeline, or building new features — feel free to open a PR.

## License

MIT License. OpenShorts is yours to use, modify, and scale.
