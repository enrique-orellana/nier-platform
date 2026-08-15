import React, { useEffect, useState } from 'react';
import { getApiUrl } from '../config';
import HookModal from './HookModal';
import SubtitleModal from './SubtitleModal';
import TranslateModal from './TranslateModal';
import ClipWorkflowStatus from './ClipWorkflowStatus';
import FullScreenEditor from './editor/FullScreenEditor';

// Route MinIO presigned URLs through the backend proxy to fix CORS/loopback issues.
// Both browser-side and server-side Remotion flows use same-origin proxy URLs.
// The backend rewrites renderer requests to an internal backend URL before
// forwarding them to the render service.

const getUrlFilename = (url) => {
    if (!url) return '';
    try {
        const parsed = new URL(url, window.location.origin);
        const pathname = decodeURIComponent(parsed.pathname || '');
        return pathname.split('/').filter(Boolean).pop() || '';
    } catch {
        return url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
    }
};

const toProxiedVideoUrl = (url) => {
    if (!url) return url;
    // Blob URLs and relative paths are already local — no proxy needed
    if (url.startsWith('blob:') || !url.startsWith('http')) return url;
    const encoded = encodeURIComponent(url);
    const proxyFilename = getUrlFilename(url) || 'video.mp4';
    // Relative URL — browser uses same-origin and backend resolves it for the renderer
    return getApiUrl(`/api/video-proxy/${encodeURIComponent(proxyFilename)}?url=${encoded}`);
};

// Sub-components
import VideoPreview from './ResultCard/VideoPreview';
import CardContent from './ResultCard/CardContent';
import CardActions from './ResultCard/CardActions';
import PostModal from './ResultCard/PostModal';

export default function ResultCard({ clip, index, jobId, uploadPostKey, uploadUserId, aiProvider = 'gemini', aiApiKey, getAiHeaders, geminiApiKey, elevenLabsKey, onPlay, onPause, workflowStatus = 'not_reviewed', workflowStatusSaving = false, onWorkflowStatusChange, editorOpen = false, editorVersionId = null, onEditorOpen, onEditorClose, onEditorVersionChange }) {
    const [showModal, setShowModal] = useState(false);
    const [showSubtitleModal, setShowSubtitleModal] = useState(false);
    const videoRef = React.useRef(null);
    const trueOriginalUrl = toProxiedVideoUrl(getApiUrl(clip.original_video_url || clip.video_url)); // The absolute, unedited original
    const originalVideoUrl = toProxiedVideoUrl(getApiUrl(clip.video_url)); // Never changes — used for Remotion previews
    const [currentVideoUrl, setCurrentVideoUrl] = useState(originalVideoUrl);
    const [persistedVideoUrl, setPersistedVideoUrl] = useState(originalVideoUrl);
    const lastObjectUrlRef = React.useRef(null);

    const [platforms, setPlatforms] = useState({
        tiktok: true,
        instagram: true,
        youtube: true
    });
    const [postTitle, setPostTitle] = useState("");
    const [postDescription, setPostDescription] = useState("");
    const [isScheduling, setIsScheduling] = useState(false);
    const [scheduleDate, setScheduleDate] = useState("");

    const [posting, setPosting] = useState(false);
    const [postResult, setPostResult] = useState(null);

    const [isEditing, setIsEditing] = useState(false);
    const [isSubtitling, setIsSubtitling] = useState(false);
    const [isHooking, setIsHooking] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isConvertingNativeShort, setIsConvertingNativeShort] = useState(false);
    const [showHookModal, setShowHookModal] = useState(false);
    const [showTranslateModal, setShowTranslateModal] = useState(false);
    const [showClipEditor, setShowClipEditor] = useState(false);
    const [editError, setEditError] = useState(null);
    const editorSessionRef = React.useRef(null);

    const [clipDuration, setClipDuration] = useState(clip.end && clip.start ? clip.end - clip.start : 30);

    // Accumulate Remotion layers across operations
    const [activeLayers, setActiveLayers] = useState({ subtitles: null, hook: null, effects: null });

    useEffect(() => {
        if (lastObjectUrlRef.current && lastObjectUrlRef.current !== currentVideoUrl) {
            URL.revokeObjectURL(lastObjectUrlRef.current);
            lastObjectUrlRef.current = null;
        }

        if (currentVideoUrl.startsWith('blob:')) {
            lastObjectUrlRef.current = currentVideoUrl;
        }
    }, [currentVideoUrl]);

    useEffect(() => {
        return () => {
            if (lastObjectUrlRef.current) {
                URL.revokeObjectURL(lastObjectUrlRef.current);
                lastObjectUrlRef.current = null;
            }
        };
    }, []);

    const getSourceVideoUrl = () => persistedVideoUrl || originalVideoUrl;
    const getVideoFilename = () => getUrlFilename(getSourceVideoUrl());
    const getRendererSourceUrl = () => toProxiedVideoUrl(getSourceVideoUrl());

    const applyRenderedVideoUrl = (nextUrl, { persist = false } = {}) => {
        if (persist) {
            setPersistedVideoUrl(nextUrl);
        }
        setCurrentVideoUrl(nextUrl);
        if (videoRef.current) {
            videoRef.current.load();
        }
    };

    const renderNativeShortAndPersist = async (renderLayers) => {
        const renderRes = await fetch(getApiUrl('/api/render'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId,
                clipIndex: index,
                props: {
                    videoUrl: getRendererSourceUrl(),
                    durationInFrames: Math.max(1, Math.round(clipDuration * (clip.output_fps || 30))),
                    fps: clip.output_fps || 30,
                    width: clip.output_width || 1080,
                    height: clip.output_height || 1920,
                    subtitles: renderLayers?.subtitles || null,
                    hook: renderLayers?.hook || null,
                    effects: renderLayers?.effects || null,
                },
            }),
        });

        if (!renderRes.ok) {
            throw new Error(await renderRes.text());
        }

        const renderData = await renderRes.json();
        const renderId = renderData.renderId;
        if (!renderId) {
            throw new Error('Render service did not return a render ID.');
        }

        let finishedRender = null;
        let isProcessing = true;
        while (isProcessing) {
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const statusRes = await fetch(getApiUrl(`/api/render/${renderId}`));
            if (!statusRes.ok) {
                throw new Error(await statusRes.text());
            }

            finishedRender = await statusRes.json();
            if (finishedRender.status === 'done') {
                isProcessing = false;
            }
            if (finishedRender.status === 'error') {
                throw new Error(finishedRender.error || 'Quality render failed.');
            }
        }

        const outputUrl = finishedRender?.outputUrl || '';
        const outputFilename = outputUrl.split(/[\\/]/).filter(Boolean).pop();
        if (!outputFilename) {
            throw new Error('Native short render completed, but no output file was returned.');
        }

        const newVideoUrl = `/videos/${jobId}/${outputFilename}`;
        const persistRes = await fetch(getApiUrl(`/api/clip/${jobId}/${index}/video-url`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_video_url: newVideoUrl }),
        });

        if (!persistRes.ok) {
            throw new Error(await persistRes.text());
        }

        return getApiUrl(newVideoUrl);
    };

    const renderRemotionLayers = async (renderLayers) => {
        // The user explicitly demanded backend rendering since their browser is failing to decode the video.
        // We bypass `renderInBrowser` entirely and force the backend to process it natively.
        const outputUrl = await renderNativeShortAndPersist(renderLayers);
        applyRenderedVideoUrl(outputUrl, { persist: true });
        return outputUrl;
    };

    // Fetch clip duration from transcript endpoint
    useEffect(() => {
        if (!jobId || index === undefined) return;
        fetch(getApiUrl(`/api/clip/${jobId}/${index}/transcript`))
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.durationSec) setClipDuration(data.durationSec);
            })
            .catch(() => {});
    }, [jobId, index]);

    // Initialize/Reset form when modal opens
    useEffect(() => {
        if (showModal) {
            setPostTitle(clip.video_title_for_youtube_short || "Viral Short");
            setPostDescription(clip.video_description_for_instagram || clip.video_description_for_tiktok || "");
            setIsScheduling(false);
            setScheduleDate("");
            setPostResult(null);
        }
    }, [showModal, clip]);

    const handleAutoEdit = async () => {
        setIsEditing(true);
        setEditError(null);
        try {
            const apiKey = aiApiKey || geminiApiKey || localStorage.getItem('gemini_key');

            if (aiProvider === 'gemini' && !apiKey) {
                throw new Error("Gemini API Key is missing. Please set it in Settings.");
            }

            const headers = getAiHeaders ? getAiHeaders('json') : {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'X-Gemini-Key': apiKey } : {}),
            };

            // Try Remotion effects endpoint first
            const effectsRes = await fetch(getApiUrl('/api/effects/generate'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: getVideoFilename()
                })
            });

            if (effectsRes.ok) {
                const data = await effectsRes.json();
                if (data.effects && data.effects.segments) {
                    const newLayers = { ...activeLayers, effects: data.effects };
                    setActiveLayers(newLayers);
                    if (editorSessionRef.current) {
                        editorSessionRef.current.applyLayer('effects', data.effects);
                        return;
                    }
                    await renderRemotionLayers(newLayers);
                    return;
                }
            }

            // Fallback: legacy FFmpeg edit endpoint
            const res = await fetch(getApiUrl('/api/edit'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: getVideoFilename()
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    throw new Error(errText);
                }
            }

            const data = await res.json();
            if (data.new_video_url) {
                const nextUrl = getApiUrl(data.new_video_url);
                if (editorSessionRef.current) editorSessionRef.current.setSourceVideo(nextUrl);
                else applyRenderedVideoUrl(nextUrl, { persist: true });
            }

        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsEditing(false);
        }
    };

    const handleConvertNativeShort = async () => {
        setIsConvertingNativeShort(true);
        setEditError(null);

        try {
            if (editorSessionRef.current) {
                await editorSessionRef.current.save();
                return;
            }
            const renderLayers = activeLayers;
            const nextUrl = await renderNativeShortAndPersist(renderLayers);
            applyRenderedVideoUrl(nextUrl, { persist: true });
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsConvertingNativeShort(false);
        }
    };

    const handleSubtitle = async (options) => {
        setIsSubtitling(true);
        setEditError(null);
        try {
            if (options.remotion) {
                // Accumulate layer and render all layers together
                const newLayers = { ...activeLayers, subtitles: options.remotion };
                setActiveLayers(newLayers);
                if (editorSessionRef.current) {
                    editorSessionRef.current.applyLayer('subtitles', options.remotion);
                    setShowSubtitleModal(false);
                    return;
                }
                await renderRemotionLayers(newLayers);
                setShowSubtitleModal(false);
                return;
            }

            // Fallback: legacy FFmpeg
            const res = await fetch(getApiUrl('/api/subtitle'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    position: options.position,
                    font_size: options.fontSize,
                    font_name: options.fontName,
                    font_color: options.fontColor,
                    border_color: options.borderColor,
                    border_width: options.borderWidth,
                    bg_color: options.bgColor,
                    bg_opacity: options.bgOpacity,
                    input_filename: getVideoFilename()
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                const nextUrl = getApiUrl(data.new_video_url);
                if (editorSessionRef.current) editorSessionRef.current.setSourceVideo(nextUrl);
                else applyRenderedVideoUrl(nextUrl, { persist: true });
                setShowSubtitleModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsSubtitling(false);
        }
    };

    const handleHook = async (hookData) => {
        setIsHooking(true);
        setEditError(null);
        try {
            if (hookData.remotion) {
                // Accumulate layer and render all layers together
                const newLayers = { ...activeLayers, hook: hookData.remotion };
                setActiveLayers(newLayers);
                if (editorSessionRef.current) {
                    editorSessionRef.current.applyLayer('hook', hookData.remotion);
                    setShowHookModal(false);
                    return;
                }
                await renderRemotionLayers(newLayers);
                setShowHookModal(false);
                return;
            }

            // Fallback: legacy FFmpeg
            const payload = typeof hookData === 'string'
                ? { text: hookData, position: 'top', size: 'M' }
                : hookData;

            const res = await fetch(getApiUrl('/api/hook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    text: payload.text,
                    position: payload.position,
                    size: payload.size,
                    input_filename: getVideoFilename()
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                const nextUrl = getApiUrl(data.new_video_url);
                if (editorSessionRef.current) editorSessionRef.current.setSourceVideo(nextUrl);
                else applyRenderedVideoUrl(nextUrl, { persist: true });
                setShowHookModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsHooking(false);
        }
    };

    const handleTranslate = async (options) => {
        console.log('[Translate] Starting translation with options:', options);
        setIsTranslating(true);
        setEditError(null);
        try {
            const apiKey = elevenLabsKey;
            if (!apiKey) {
                throw new Error("ElevenLabs API Key is missing. Please set it in Settings.");
            }

            const requestBody = {
                job_id: jobId,
                clip_index: index,
                target_language: options.targetLanguage,
                input_filename: getVideoFilename()
            };

            const res = await fetch(getApiUrl('/api/translate'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-ElevenLabs-Key': apiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!res.ok) {
                const errText = await res.text();
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    throw new Error(errText);
                }
            }

            const data = await res.json();
            if (data.new_video_url) {
                const nextUrl = getApiUrl(data.new_video_url);
                if (editorSessionRef.current) editorSessionRef.current.setSourceVideo(nextUrl);
                else applyRenderedVideoUrl(nextUrl, { persist: true });
                setShowTranslateModal(false);
            }

        } catch (e) {
            console.error('[Translate] Exception:', e);
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsTranslating(false);
        }
    };

    const handlePost = async () => {
        if (!uploadPostKey || !uploadUserId) {
            setPostResult({ success: false, msg: "Missing API Key or User ID." });
            return;
        }

        const selectedPlatforms = Object.keys(platforms).filter(k => platforms[k]);
        if (selectedPlatforms.length === 0) {
            setPostResult({ success: false, msg: "Select at least one platform." });
            return;
        }

        if (isScheduling && !scheduleDate) {
            setPostResult({ success: false, msg: "Please select a date and time." });
            return;
        }

        setPosting(true);
        setPostResult(null);

        try {
            const payload = {
                job_id: jobId,
                clip_index: index,
                api_key: uploadPostKey,
                user_id: uploadUserId,
                platforms: selectedPlatforms,
                title: postTitle,
                description: postDescription
            };

            if (isScheduling && scheduleDate) {
                // Convert to ISO-8601
                payload.scheduled_date = new Date(scheduleDate).toISOString();
                // Optional: pass timezone if needed, backend defaults to UTC or we can send user's timezone
                payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            }

            const res = await fetch(getApiUrl('/api/social/post'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await res.text();
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    throw new Error(errText);
                }
            }

            setPostResult({ success: true, msg: isScheduling ? "Scheduled successfully!" : "Posted successfully!" });
            setTimeout(() => {
                setShowModal(false);
                setPostResult(null);
            }, 3000);

        } catch (e) {
            setPostResult({ success: false, msg: `Failed: ${e.message}` });
        } finally {
            setPosting(false);
        }
    };

    const handleDownload = async (event) => {
        event?.preventDefault?.();
        try {
            const response = await fetch(currentVideoUrl);
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.style.display = 'none';
            anchor.href = url;
            anchor.download = `clip-${index + 1}.mp4`;
            document.body.appendChild(anchor);
            anchor.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(anchor);
        } catch (error) {
            console.error('Download error:', error);
            window.open(currentVideoUrl, '_blank');
        }
    };

    return (
        <div className="bg-surface border border-white/5 rounded-2xl overflow-hidden flex flex-col group hover:border-white/10 transition-all animate-[fadeIn_0.5s_ease-out] h-full" style={{ animationDelay: `${index * 0.1}s` }}>
            <VideoPreview
                videoRef={videoRef}
                currentVideoUrl={currentVideoUrl}
                trueOriginalUrl={trueOriginalUrl}
                index={index}
                isEditing={isEditing}
                isConvertingNativeShort={isConvertingNativeShort}
                onPlay={onPlay}
                onPause={onPause}
                clip={clip}
            />

            <div className="flex-1 p-5 flex flex-col bg-[#121214] overflow-hidden min-w-0">
                <ClipWorkflowStatus
                    status={workflowStatus}
                    saving={workflowStatusSaving}
                    onChange={onWorkflowStatusChange}
                />
                <CardContent clip={clip} />

                <CardActions
                    handleAutoEdit={handleAutoEdit}
                    isEditing={isEditing}
                    handleConvertNativeShort={handleConvertNativeShort}
                    isConvertingNativeShort={isConvertingNativeShort}
                    setShowSubtitleModal={setShowSubtitleModal}
                    isSubtitling={isSubtitling}
                    setShowHookModal={setShowHookModal}
                    isHooking={isHooking}
                    setShowTranslateModal={setShowTranslateModal}
                    isTranslating={isTranslating}
                    setShowModal={setShowModal}
                    editError={editError}
                    setShowClipEditor={onEditorOpen || setShowClipEditor}
                    handleDownload={handleDownload}
                />
            </div>

            <PostModal
                showModal={showModal}
                setShowModal={setShowModal}
                postTitle={postTitle}
                setPostTitle={setPostTitle}
                postDescription={postDescription}
                setPostDescription={setPostDescription}
                isScheduling={isScheduling}
                setIsScheduling={setIsScheduling}
                scheduleDate={scheduleDate}
                setScheduleDate={setScheduleDate}
                platforms={platforms}
                setPlatforms={setPlatforms}
                postResult={postResult}
                posting={posting}
                uploadPostKey={uploadPostKey}
                handlePost={handlePost}
            />

            <SubtitleModal
                isOpen={showSubtitleModal}
                onClose={() => setShowSubtitleModal(false)}
                onGenerate={handleSubtitle}
                isProcessing={isSubtitling}
                videoUrl={originalVideoUrl}
                jobId={jobId}
                clipIndex={index}
                existingHook={activeLayers.hook}
            />

            <HookModal
                isOpen={showHookModal}
                onClose={() => setShowHookModal(false)}
                onGenerate={handleHook}
                isProcessing={isHooking}
                videoUrl={originalVideoUrl}
                initialText={clip.viral_hook_text}
                durationInSeconds={clip.end && clip.start ? clip.end - clip.start : 30}
                existingSubtitles={activeLayers.subtitles}
                layoutFormat={clip.layout_format || 'standard'}
                facecamSize={clip.facecam_size || 'medium'}
            />

            <TranslateModal
                isOpen={showTranslateModal}
                onClose={() => setShowTranslateModal(false)}
                onTranslate={handleTranslate}
                isProcessing={isTranslating}
                videoUrl={currentVideoUrl}
                hasApiKey={!!elevenLabsKey}
            />
            <FullScreenEditor
                isOpen={editorOpen || showClipEditor}
                initialVersionId={editorVersionId}
                onClose={onEditorClose || (() => setShowClipEditor(false))}
                onVersionChange={onEditorVersionChange}
                clip={clip}
                jobId={jobId}
                clipIndex={index}
                aiHeaders={getAiHeaders ? getAiHeaders('json') : {}}
                onRendered={(url) => applyRenderedVideoUrl(url, { persist: true })}
                onSessionReady={(session) => { editorSessionRef.current = session; }}
                useLocalEditor={editorOpen}
                editorActions={{
                    onAutoEdit: handleAutoEdit,
                    isEditing,
                    onConvertNativeShort: handleConvertNativeShort,
                    isConvertingNativeShort,
                    onSubtitles: () => setShowSubtitleModal(true),
                    isSubtitling,
                    onViralHook: () => setShowHookModal(true),
                    isHooking,
                    onDubVoice: () => setShowTranslateModal(true),
                    isTranslating,
                    onPost: () => setShowModal(true),
                    onDownload: handleDownload,
                    editError,
                }}
            />
        </div>
    );
}
