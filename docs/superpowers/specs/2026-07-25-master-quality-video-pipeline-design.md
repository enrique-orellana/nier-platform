# Master-Quality Video Pipeline Design

## Objective

OpenShorts will produce master-quality H.264/MP4 video in every workflow. The pipeline will preserve genuine source detail and source frame rate, eliminate avoidable generational compression, and stop presenting upscaled or repeatedly encoded files as quality improvements.

This design applies to:

- long-video clipping from uploads and downloaded sources;
- crop and active-speaker reframing;
- subtitles, hooks, effects, and translations;
- Remotion-based edits and exports;
- SaaS Shorts scene assembly, voice, music, captions, and overlays.

Master quality is mandatory. There is no lower-quality export preset.

## Current Problem

The long-video pipeline currently performs multiple lossy operations:

1. It extracts a selected clip by encoding H.264 at CRF 18.
2. It decodes that clip frame by frame through OpenCV.
3. It crops or builds a general-layout frame, resizes it, and encodes again at CRF 23.
4. Later subtitle, hook, effect, translation, or Remotion operations may encode the resulting video again.
5. Some render paths force 30 fps and a 1080x1920 canvas regardless of the source.

A 1920x1080 landscape source contains only about 608x1080 pixels after a centered 9:16 crop. Enlarging that crop to 1080x1920 changes the file dimensions but cannot add image detail. Repeated H.264 encoding then introduces further softness, blocking, ringing, and motion degradation.

The SaaS pipeline similarly normalizes and recomposes already encoded generated assets in multiple stages. Compression performed by external generation providers is unavoidable, but OpenShorts should add only one lossy generation when assembling the final video.

The existing Improve Quality operation re-encodes a degraded video with stronger settings and sharpening. It can change its appearance but cannot recover discarded detail.

## Chosen Approach

OpenShorts will use one manifest-driven master render pipeline.

Downloaded, uploaded, and AI-generated source media are immutable inputs. Editing operations update structured project state instead of replacing the current video with another encoded file. The final exporter reads the immutable sources and applies trimming, reframing, scene assembly, effects, text, and audio in a single composition followed by one H.264 encode.

The pipeline is:

```text
immutable source assets
        +
versioned render manifest
        |
        v
preflight and output-policy calculation
        |
        v
trim + crop + scale + composite + audio
        |
        v
one H.264/MP4 master encode
        |
        v
post-render validation and atomic publication
```

Remotion remains the visual compositor. It reads source assets directly, applies time-based transforms and layers, and supplies frames to its underlying encoder. FFmpeg and ffprobe remain responsible for media inspection, encoding support, and output validation. The browser does not choose authoritative dimensions, FPS, or codec quality settings.

## Alternatives Rejected

### High-Quality Intermediate

A near-lossless vertical intermediate would reduce damage between editing stages, but it would require very large files and would retain unnecessary media generations. It is useful only as a future render cache, not as the canonical source or export architecture.

### Tune the Existing Encodes

Lower CRF values, slower presets, and Lanczos scaling would reduce visible damage but would not eliminate repeated decoding and encoding. This treats the symptoms while retaining the root cause.

## Immutable Source Assets

Every project registers its original media as immutable assets:

- uploaded long-form files;
- downloaded source files at the best available resolution;
- AI-generated SaaS scene clips;
- voice, music, and other audio;
- still images and graphical assets.

Each asset record contains:

- a stable asset ID;
- storage location;
- byte size;
- content checksum;
- media probe metadata;
- creation source and project association.

Exports never overwrite source assets. An edit or rerender always resolves the original asset ID instead of using the URL of the most recent export.

Source retention must last for at least as long as the project remains rerenderable. Cleanup logic must distinguish immutable project sources from temporary render artifacts.

## Media Probe

A central media probe runs ffprobe and records:

- coded and display width and height;
- sample aspect ratio and display aspect ratio;
- rational and average frame rates;
- duration and time base;
- video codec, profile, level, and pixel format;
- color range, primaries, transfer, and matrix;
- rotation and other relevant display metadata;
- audio codec, channels, layout, sample rate, and duration;
- variable-frame-rate indicators.

Probe results are canonical. UI values and hard-coded defaults must not override successfully probed properties.

Invalid or missing metadata causes preflight failure with an actionable error. Conservative fallback values may be used only when a media stream genuinely omits a nonessential field, and the fallback must be recorded in the render log.

## Crop Analysis

The existing scene, face, person, and active-speaker analysis remains responsible for editorial framing. It no longer writes resized video frames.

It emits a crop track with:

- source-relative crop rectangles;
- timestamps or source-frame positions;
- scene boundaries;
- transition behavior between keyframes;
- framing strategy, such as tracked crop or general layout.

Scene changes create hard crop changes. Movement within a scene uses the existing stabilized camera behavior expressed as smoothed keyframes. Crop coordinates are normalized or tied to the probed source dimensions so they can be validated and reproduced deterministically.

The general layout is also declarative: it records foreground fit and background treatment instead of rasterizing an intermediate video.

## Versioned Render Manifest

The persisted render manifest is the canonical editable project state. It contains:

- manifest schema version;
- project and clip identifiers;
- immutable source asset references;
- source trim ranges;
- crop tracks and general-layout instructions;
- SaaS scene order and timing;
- subtitles, hooks, effects, and transitions;
- voice, music, and audio-mix instructions;
- target 9:16 aspect ratio;
- the fixed master export policy;
- asset checksums expected at render time.

Each editing action updates the manifest. It does not render over or promote an existing export as the next input.

The manifest schema is shared by the long-video and SaaS workflows. Workflow-specific fields may exist in bounded sections, but both workflows resolve through the same export policy and master exporter.

## Preview Behavior

The UI preview reads the manifest and composes source media with the active layers. It may use proxy media or reduced preview resolution for interactive responsiveness, but preview artifacts are never published, posted, downloaded as masters, or used as inputs to a later render.

The UI labels preview state clearly when it is not displaying full-resolution output. Export quality is never inferred from preview playback quality.

For long-video results, the preview uses the source trim and crop track without first creating a disposable compressed vertical clip.

## Master Export Policy

### Container and Codec

- Container: MP4.
- Video codec: H.264 through libx264 or Remotion's equivalent supported H.264 path.
- H.264 profile: High.
- Pixel format: yuv420p for universal browser, device, and social-platform compatibility.
- Rate control: constant quality at CRF 14.
- Encoder preset: veryslow.
- MP4 fast-start metadata is required.

The exporter must expose these settings through one central policy rather than duplicating literals across Python, TypeScript, and UI code.

### Aspect Ratio and Resolution

- Output aspect ratio is 9:16.
- Genuine detail is preserved up to 2160x3840.
- Enlargement is disabled by default.
- Downscaling uses Lanczos.
- Output dimensions are even and H.264-compatible.
- Rounding must preserve the target aspect ratio within one output pixel.

The output resolution is derived from the usable source region after rotation and crop:

- A native portrait source can retain its native portrait resolution up to 2160x3840.
- A landscape source uses the real pixel dimensions of its 9:16 crop.
- A general layout uses the largest 9:16 canvas supported by the source height and foreground detail without enlarging the source.
- Mixed-source SaaS compositions use the highest canvas that does not require enlargement of the primary visual assets. Lower-resolution secondary sources are fitted without falsely redefining the whole project as higher-detail media.

If source media cannot support 1080x1920, OpenShorts exports the honest lower resolution and reports the limitation. It does not upscale merely to claim a social-standard dimension.

### Frame Rate

- Preserve the authoritative source frame rate up to 60 fps.
- Do not force 30 fps.
- Variable-frame-rate sources are normalized to a stable constant frame rate matching the best authoritative detected rate.
- Mixed-source compositions use the primary timeline rate, capped at 60 fps, with deterministic frame sampling for secondary assets.
- Frame-rate selection is performed by the backend and recorded in the manifest render result.

### Color

Universal H.264/MP4 playback is the overriding compatibility requirement.

- SDR sources retain correct SDR color metadata.
- HDR sources are explicitly tone-mapped to high-quality SDR.
- The exporter must not silently reinterpret HDR as SDR or omit required conversion metadata.
- Rotation, range, transfer, primaries, and matrix metadata must be handled explicitly during normalization.

### Audio

- Audio is mixed and encoded once.
- Final codec is AAC.
- Sample rate is 48 kHz.
- Target bitrate is 320 kbps.
- Channel layout is preserved where compatible; social-oriented stereo output is used when mixing requires a common layout.
- Loudness handling and mixing occur in the final composition rather than through serial intermediate exports.

### Sharpening

Global sharpening is prohibited. Mild resolution-aware sharpening may be applied after meaningful downscaling when objective and visual fixtures show that it compensates for resampling softness. It must not run after enlargement and must not be described as detail recovery.

## Workflow Behavior

### Long-Video Clips

1. Register and probe the original upload or highest-quality download.
2. Transcribe and select source-time clip ranges.
3. Analyze scenes and produce crop tracks against the original timeline.
4. Create manifest-backed result previews.
5. Store subtitle, hook, effect, translation, and other changes in the manifest.
6. Render directly from the original source range when a downloadable or postable master is required.

The preliminary CRF-18 clip encode and the OpenCV-to-CRF-23 vertical encode are removed from the canonical path.

### SaaS Shorts

1. Register each externally generated scene and audio element as an immutable asset.
2. Probe all assets.
3. Store scene order, duration, normalization, captions, transitions, overlays, voice, music, and mix instructions in the manifest.
4. Preview from the manifest.
5. Normalize and composite all assets during the single final master render.

External provider compression cannot be undone. OpenShorts adds only the final master encode.

### Translation and Audio Replacement

Translation creates a new immutable audio asset and updates the manifest's audio instructions. It does not encode a replacement video before the final export.

### Social Publishing

Publishing requires a successfully validated master associated with the current manifest revision. If the manifest changes after an export, the existing master becomes stale and publishing triggers or requests a new master render.

## Removing False Quality Improvement

The Improve Quality endpoint and UI action are removed from new projects. Every export already uses the master policy, and re-encoding an existing compressed file cannot restore lost information.

Legacy projects may be rerendered from their original source when it remains available. When only a processed file exists, the project is marked as using a legacy source. OpenShorts may produce a compatible master from that file but must not claim recovered source detail.

## Preflight and Failure Handling

Before rendering, the exporter:

1. Validates the manifest schema and version.
2. Resolves every referenced asset.
3. Verifies asset size and checksum.
4. Probes media and compares it with recorded properties.
5. Validates trim ranges, durations, crop bounds, layer timing, and scene order.
6. Calculates authoritative output resolution, FPS, and color conversion.
7. Estimates temporary disk requirements and checks available capacity.
8. Records the chosen render policy and any honest source limitation.

Rendering writes to a unique temporary file. The output becomes the current project master only when:

- the renderer exits successfully;
- ffprobe can read the complete output;
- codec, pixel format, dimensions, FPS, duration, audio, and color properties match policy;
- frame count and audio/video duration are within defined tolerances.

Publication uses an atomic rename or equivalent storage promotion. A failure or cancellation leaves the previous valid master and manifest untouched. Temporary artifacts are cleaned without deleting immutable sources.

Errors identify the failing asset, manifest field, or validation rule. Render logs contain media properties, policy decisions, progress, warnings, and validation results but never credentials or signed secret URLs.

## Migration

Existing projects migrate lazily:

1. Detect whether the original source asset still exists.
2. Probe and register it if available.
3. Convert persisted edits and metadata into the current manifest schema where possible.
4. Generate crop analysis when required.
5. Mark the project rerenderable from source.

If only a processed clip exists, register that file as a legacy source and show the limitation in the UI. Do not fabricate original-source lineage.

Old exported videos remain available until normal retention removes them. They are never selected as inputs when a valid immutable source exists.

## Verification Strategy

### Unit Tests

Tests cover:

- media-probe parsing and rational frame rates;
- output-resolution selection and no-upscale behavior;
- even dimension and 9:16 rounding;
- FPS preservation and 60 fps cap;
- HDR-to-SDR policy selection;
- manifest schema and timing validation;
- crop-track bounds and interpolation;
- centralized H.264, audio, and MP4 settings;
- stale-master detection after manifest changes;
- immutable-source resolution instead of last-export resolution.

### Crop Regression Tests

Existing tracking fixtures compare the crop-track output with the current stabilized speaker-framing behavior. Scene changes, missing detections, groups, and general-layout scenes are covered.

### Integration Fixtures

The suite includes:

- landscape and portrait media;
- sources below 1080p, at 1080p, and at 4K;
- 24, 25, 30, 50, and 60 fps;
- variable-frame-rate input;
- rotated media;
- silent input;
- mono and stereo audio;
- SDR and HDR input;
- mixed-resolution SaaS scenes.

### Output Assertions

ffprobe assertions verify:

- MP4 container;
- H.264 video and High profile;
- yuv420p;
- expected honest dimensions;
- expected constant FPS;
- duration and frame count;
- AAC at 48 kHz;
- audio/video synchronization;
- correct SDR color metadata;
- fast-start layout where test tooling can inspect it.

### Quality Regression Tests

Representative fixture renders use SSIM and VMAF comparisons against a reference composition derived directly from source media. Thresholds are established from the accepted implementation baseline and prevent later changes from introducing unnecessary generations, poor scaling, or encoder regressions.

A dedicated lineage test applies several sequential edits and proves that every export reads the immutable original sources, never the previously exported MP4.

Both long-video and SaaS workflows must pass through the same exporter in integration tests.

## Operational Visibility

Each render records:

- manifest revision;
- source asset IDs and verified checksums;
- probed source properties;
- chosen resolution, FPS, and color path;
- H.264 and audio policy version;
- progress and elapsed time;
- post-render validation results;
- source-quality limitations.

These records make regressions diagnosable and allow a master to be traced to its exact sources and manifest revision.

## Acceptance Criteria

The design is complete when:

- all new video workflows retain immutable source assets;
- edits update manifests instead of creating chained video inputs;
- long-video output no longer requires the preliminary clip and vertical H.264 encodes;
- SaaS assembly performs one OpenShorts-controlled final encode;
- exports use H.264 High Profile, CRF 14, veryslow, yuv420p, and MP4 fast-start;
- source FPS is preserved up to 60 fps;
- output preserves genuine detail up to 2160x3840 without default enlargement;
- final audio is AAC, 48 kHz, 320 kbps;
- HDR is explicitly tone-mapped to SDR;
- outputs pass post-render validation before publication;
- the Improve Quality action is removed;
- legacy projects communicate their source limitations honestly;
- automated tests detect repeat encoding, FPS forcing, false upscaling, A/V drift, and quality regressions.

## Out of Scope

- HEVC, AV1, ProRes, or other delivery codecs;
- HDR delivery;
- AI super-resolution or generative detail recovery;
- multiple user-selectable quality presets;
- retaining preview proxies as export sources;
- changing the editorial logic used to select viral moments.
