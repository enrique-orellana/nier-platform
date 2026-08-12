# Video generation optimization benchmark

Date: 2026-08-12  
Branch: `perf/video-generation-optimization`

## Scope

This benchmark covers the shared source-analysis cache, direct decoder seeking, direct-seek audio extraction, final-output validation, and stage metrics. The export contract remained unchanged: H.264, CRF 14, `veryslow`, yuv420p, AAC 48 kHz at 320 kbps, and faststart MP4.

## Real project status

The affected project source for `be9d988c-2b40-46ec-86b8-329b7b45e69a` was not present in this worktree, so a same-source before/after benchmark could not be rerun.

The earlier investigation recorded the following baseline for that project:

- Approximately 38 minutes of source video.
- 15 requested clips and approximately 668 seconds of output.
- Approximately 940,962 source frames decoded by the per-clip read-from-zero path.
- Scene detection and scene-strategy analysis repeated for every clip.

Those figures are retained as baseline context, not presented as a new optimized production measurement.

## Synthetic 15-clip smoke benchmark

Input: 60-second, 640x360, 30 FPS H.264/AAC test video generated with FFmpeg.  
Plan: 15 two-second clips starting at 0, 3, 6, ..., 42 seconds.  
Strategy: one `GENERAL` scene, serial rendering, unchanged master encoder policy.

| Metric | Optimized result |
|---|---:|
| Clips requested / validated | 15 / 15 |
| Wall-clock time | 14.98 s |
| Decoded source frames | 900 |
| Decoder preroll frames | 0 |
| Output frames | 900 |
| Total output bytes | 1,965,613 |
| Audio stage | 3.17 s |
| Frame-processing stage | 4.27 s |
| Encode/merge stage | 2.98 s |
| Validation stage | 1.36 s |

The previous read-from-zero algorithm would decode 10,350 source frames for this same plan before processing the requested ranges. The optimized run therefore decoded 91.3% fewer frames in this controlled case (900 vs. 10,350). This is a decode-work comparison, not a claim of production wall-clock or cloud-cost savings.

Independent `ffprobe` checks passed for all 15 outputs:

- H.264 video.
- 202x360 output dimensions for the synthetic source.
- 30 FPS.
- Positive two-second duration.
- AAC audio stream.

## Quality assessment

The smoke outputs were playable and met the media contract. The synthetic source contains no faces, speakers, scene changes, or subtitles, so it cannot validate crop tracking or visual quality against the affected project.

## Acceptance decision

The implementation is ready for a real-project A/B run, with the following required evidence before changing encoder presets or adding parallel workers:

1. Run the same 15-clip plan against the original project source.
2. Confirm scene detection and strategy analysis each execute once.
3. Compare decoded frames, wall time, output bytes, and stage metrics.
4. Visually compare speaker tracking, group/general scenes, subtitles, scene transitions, audio sync, and late-source clips.
