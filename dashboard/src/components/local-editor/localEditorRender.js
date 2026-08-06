import { getApiUrl } from '../../config';
import { renderInBrowser } from '../../lib/renderInBrowser';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const buildRemotionRenderProps = ({
    durationSeconds,
    fps = 30,
    width,
    height,
    subtitleCues = [],
    subtitleStyle = null,
    hook = null,
}) => ({
    durationInFrames: Math.max(1, Math.round(Number(durationSeconds || 0) * Number(fps || 30))),
    fps: Number(fps || 30),
    width: Number(width),
    height: Number(height),
    subtitles: subtitleCues.length
        ? {
            captions: subtitleCues.flatMap(({ text, startMs, endMs, captions }) => (
                Array.isArray(captions) && captions.length
                    ? captions.map((caption) => ({ text: String(caption.text || ''), startMs: Number(caption.startMs), endMs: Number(caption.endMs) }))
                    : [{ text: String(text || ''), startMs: Number(startMs), endMs: Number(endMs) }]
            )),
            position: subtitleStyle?.position || 'bottom',
            style: subtitleStyle || undefined,
        }
        : null,
    hook: hook
        ? {
            text: String(hook.text || ''),
            position: hook.position || 'top',
            size: hook.size || 'M',
            entranceAnimation: hook.entranceAnimation || 'none',
            displayDurationSec: Math.max(0.001, (Number(hook.endMs) - Number(hook.startMs)) / 1000),
            startMs: Number(hook.startMs) || 0,
            endMs: Number(hook.endMs),
        }
        : null,
    effects: null,
});

export async function renderLocalVideoOnBrowser({
    videoUrl,
    durationSeconds,
    fps = 30,
    width,
    height,
    subtitleCues = [],
    subtitleStyle = null,
    hook = null,
    onProgress = () => {},
    signal,
}) {
    const props = buildRemotionRenderProps({ durationSeconds, fps, width, height, subtitleCues, subtitleStyle, hook });
    return renderInBrowser({
        videoUrl,
        durationInSeconds: durationSeconds,
        fps,
        width,
        height,
        subtitles: props.subtitles,
        hook: props.hook,
        effects: props.effects,
        onProgress,
        signal,
    });
}

const responsePayload = async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || `Request failed (${response.status})`);
    return payload;
};

export async function renderLocalVideoOnBackend({
    file,
    durationSeconds,
    fps = 30,
    width,
    height,
    subtitleCues = [],
    subtitleStyle = null,
    hook = null,
    onProgress = () => {},
    pollMs = 1200,
    fetchImpl = fetch,
    returnMetadata = false,
}) {
    if (!file) throw new Error('A local video is required.');
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('props', JSON.stringify(buildRemotionRenderProps({ durationSeconds, fps, width, height, subtitleCues, subtitleStyle, hook })));

    const started = await responsePayload(await fetchImpl(getApiUrl('/api/local-editor/render'), { method: 'POST', body: formData }));
    if (!started.renderId || !started.jobId) throw new Error('Render service did not return a render ID.');

    let status = null;
    do {
        if (pollMs > 0) await wait(pollMs);
        status = await responsePayload(await fetchImpl(getApiUrl(`/api/render/${started.renderId}`)));
        onProgress(Math.max(0, Math.min(1, Number(status.progress || 0) / 100)));
        if (status.status === 'error' || status.status === 'failed') throw new Error(status.error || 'Native video render failed.');
        if (status.status === 'done' || status.status === 'completed') {
            const filename = String(status.outputUrl || '').split(/[\\/]/).filter(Boolean).pop();
            if (!filename) throw new Error('Render completed without an output file.');
            onProgress(1);
            const result = {
                outputUrl: getApiUrl(`/videos/${started.jobId}/${filename}`),
                jobId: started.jobId,
                filename,
            };
            return returnMetadata ? result : result.outputUrl;
        }
    } while (status.status !== 'done' && status.status !== 'completed');
}

export async function burnLocalEditorSubtitles({
    file,
    durationSeconds,
    fps = 30,
    width,
    height,
    subtitleCues = [],
    subtitleStyle = null,
    hook = null,
    onProgress = () => {},
    pollMs = 1200,
    fetchImpl = fetch,
}) {
    if (!subtitleCues.length) {
        return renderLocalVideoOnBackend({ file, durationSeconds, fps, width, height, subtitleCues, subtitleStyle, hook, onProgress, pollMs, fetchImpl });
    }

    const hasWordTimings = subtitleCues.some((cue) => Array.isArray(cue.captions) && cue.captions.length > 0);
    if (hasWordTimings) {
        return renderLocalVideoOnBackend({ file, durationSeconds, fps, width, height, subtitleCues, subtitleStyle, hook, onProgress, pollMs, fetchImpl });
    }

    const rendered = await renderLocalVideoOnBackend({
        file,
        durationSeconds,
        fps,
        width,
        height,
        subtitleCues: [],
        subtitleStyle: null,
        hook,
        onProgress: (progress) => onProgress(Math.max(0, Math.min(0.85, Number(progress) * 0.85))),
        pollMs,
        fetchImpl,
        returnMetadata: true,
    });

    const response = await fetchImpl(getApiUrl('/api/local-editor/burn-subtitles'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: rendered.jobId,
            input_filename: rendered.filename,
            subtitle_cues: subtitleCues,
            subtitle_style: subtitleStyle || {},
        }),
    });
    const payload = await responsePayload(response);
    onProgress(1);
    return getApiUrl(payload.outputUrl);
}
