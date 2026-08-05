import {
    DEFAULT_SUBTITLE_STYLE,
    HOOK_SIZE_SCALE,
    hexToRgba,
    normalizeSubtitleStyle,
} from './localEditorStyles';

export const activeCueAt = (cues, playheadMs) => (
    (cues || []).find((cue) => playheadMs >= cue.startMs && playheadMs < cue.endMs) || null
);

export const formatClock = (ms) => {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const chooseRecordingMimeType = (isTypeSupported = () => false) => (
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((type) => isTypeSupported(type)) || ''
);

export const getRecordingOptions = (mimeType, width, height) => {
    const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
    const videoBitsPerSecond = Math.max(8_000_000, Math.min(24_000_000, Math.round(pixels * 8)));
    return {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond,
        audioBitsPerSecond: 192_000,
    };
};

export const getExportSourceUrl = (video) => String(video?.currentSrc || video?.src || '');

export const prepareVideoForExport = (video) => {
    video?.pause?.();
    if (video) video.currentTime = 0;
    return video;
};

export const getVideoFrameDimensions = (video) => {
    const width = Number(video?.videoWidth);
    const height = Number(video?.videoHeight);
    if (!width || !height) throw new Error('Video metadata is not ready for export.');
    return { width, height };
};

export const clampOverlayY = (desiredY, canvasHeight, overlayHeight, padding) => {
    const safePadding = Math.max(0, Number(padding) || 0);
    const maxY = Math.max(safePadding, (Number(canvasHeight) || 0) - (Number(overlayHeight) || 0) + safePadding);
    return Math.max(safePadding, Math.min(Number(desiredY) || 0, maxY));
};

export const hookVisualState = (hook = {}, elapsedMs = 0) => {
    const progress = Math.max(0, Math.min(1, Number(elapsedMs) / 500));
    const scale = HOOK_SIZE_SCALE[hook.size] || HOOK_SIZE_SCALE.M;
    if (hook.entranceAnimation === 'fade') return { scale, opacity: progress, translateY: 0 };
    if (hook.entranceAnimation === 'slide-up') return { scale, opacity: progress, translateY: 60 * (1 - progress) };
    if (hook.entranceAnimation === 'spring') {
        const springProgress = Math.min(1, Number(elapsedMs) / 350);
        return { scale: scale * (0.7 + springProgress * 0.3), opacity: springProgress, translateY: 0 };
    }
    return { scale, opacity: 1, translateY: 0 };
};

export const subtitleVisualStyle = (style = {}) => {
    const current = normalizeSubtitleStyle(style);
    return {
        fontFamily: current.fontFamily,
        fontSize: current.fontSize,
        color: current.fontColor,
        highlightColor: current.highlightColor,
        outlineColor: current.borderColor,
        outlineWidth: current.borderWidth,
        background: hexToRgba(current.bgColor, current.bgOpacity),
        backgroundOpacity: current.bgOpacity,
        animation: current.animation,
        position: current.position,
    };
};

const wrapTextLines = (context, text, maxWidth) => {
    const lines = String(text || '').split('\n');
    const output = [];
    lines.forEach((line) => {
        const words = line.split(/\s+/);
        let current = '';
        words.forEach((word) => {
            const candidate = current ? `${current} ${word}` : word;
            if (current && context.measureText(candidate).width > maxWidth) {
                output.push(current);
                current = word;
            } else {
                current = candidate;
            }
        });
        output.push(current);
    });
    return output;
};

const measureOverlay = (context, text, width, fontSize, fontFamily) => {
    context.save();
    context.font = `700 ${fontSize}px ${fontFamily}, sans-serif`;
    const padding = fontSize * 0.35;
    const maxWidth = width - padding * 2;
    const lines = wrapTextLines(context, text, maxWidth);
    const lineHeight = fontSize * 1.2;
    context.restore();
    return { lines, padding, lineHeight, height: lines.length * lineHeight + padding * 2 };
};

const drawOverlay = (context, text, { x, y, width, fontSize, color, background, fontFamily = 'Arial, sans-serif', borderColor = '#000000', borderWidth = 0, opacity = 1 }) => {
    if (!text) return;
    context.save();
    context.globalAlpha = opacity;
    context.font = `700 ${fontSize}px ${fontFamily}, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    const metrics = measureOverlay(context, text, width, fontSize, fontFamily);
    const measured = metrics.lines.reduce((max, line) => Math.max(max, context.measureText(line).width), 0);
    const boxWidth = Math.min(width, measured + metrics.padding * 2);
    const boxHeight = metrics.height;
    if (background && background !== 'transparent') {
        context.fillStyle = background;
        context.fillRect(x - boxWidth / 2, y - metrics.padding, boxWidth, boxHeight);
    }
    metrics.lines.forEach((line, index) => {
        const lineY = y + index * metrics.lineHeight;
        if (borderWidth > 0) {
            context.strokeStyle = borderColor;
            context.lineWidth = borderWidth * 2;
            context.strokeText(line, x, lineY);
        }
        context.fillStyle = color;
        context.fillText(line, x, lineY);
    });
    context.restore();
};

const waitForVideoReady = (video) => new Promise((resolve, reject) => {
    if (video.readyState >= 2) {
        resolve(video);
        return;
    }
    const cleanup = () => {
        video.removeEventListener('loadeddata', handleReady);
        video.removeEventListener('canplay', handleReady);
        video.removeEventListener('error', handleError);
    };
    const handleReady = () => {
        cleanup();
        resolve(video);
    };
    const handleError = () => {
        cleanup();
        reject(new Error('The local video could not be loaded for export.'));
    };
    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('canplay', handleReady);
    video.addEventListener('error', handleError);
    video.load();
});

export async function renderLocalVideo({ video, subtitleCues = [], subtitleStyle = DEFAULT_SUBTITLE_STYLE, hook = null, onProgress = () => {} }) {
    if (!video || typeof document === 'undefined') throw new Error('A local video is required.');
    if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
        throw new Error('This browser cannot render a local video export.');
    }
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support local video recording.');

    const sourceUrl = getExportSourceUrl(video);
    if (!sourceUrl) throw new Error('The local video source is not available for export.');

    const exportVideo = document.createElement('video');
    exportVideo.preload = 'auto';
    exportVideo.playsInline = true;
    exportVideo.loop = false;
    exportVideo.src = sourceUrl;
    exportVideo.setAttribute('aria-hidden', 'true');
    Object.assign(exportVideo.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
    });
    document.body?.appendChild(exportVideo);

    let scheduledFrameId = null;
    let scheduledFrameKind = null;
    let stream = null;
    let recorder = null;
    let resolveRender;
    let rejectRender;
    let settled = false;
    try {
        await waitForVideoReady(exportVideo);
        if (typeof exportVideo.captureStream !== 'function') throw new Error('This browser cannot capture local video audio.');
        const { width: sourceWidth, height: sourceHeight } = getVideoFrameDimensions(exportVideo);
        prepareVideoForExport(exportVideo);
        const canvas = document.createElement('canvas');
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const context = canvas.getContext('2d');
        const canvasStream = canvas.captureStream(30);
        const canvasVideoTrack = canvasStream.getVideoTracks()[0];
        const sourceStream = exportVideo.captureStream();
        stream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...sourceStream.getAudioTracks(),
        ]);
        const isSupported = typeof MediaRecorder.isTypeSupported === 'function'
            ? (type) => MediaRecorder.isTypeSupported(type)
            : () => true;
        const mimeType = chooseRecordingMimeType(isSupported);
        try {
            recorder = new MediaRecorder(stream, getRecordingOptions(mimeType, sourceWidth, sourceHeight));
        } catch {
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        }
        const chunks = [];
        const finish = (error = null) => {
            if (settled) return;
            settled = true;
            if (scheduledFrameId !== null) {
                if (scheduledFrameKind === 'video' && typeof exportVideo.cancelVideoFrameCallback === 'function') exportVideo.cancelVideoFrameCallback(scheduledFrameId);
                else cancelAnimationFrame(scheduledFrameId);
                scheduledFrameId = null;
            }
            stream.getTracks().forEach((track) => track.stop());
            if (error) rejectRender(error);
            else resolveRender(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
        };
        const draw = () => {
            context.drawImage(exportVideo, 0, 0, canvas.width, canvas.height);
            const nowMs = exportVideo.currentTime * 1000;
            const subtitle = activeCueAt(subtitleCues, nowMs);
            const subtitleStyleValues = subtitleVisualStyle(subtitleStyle);
            if (subtitle) {
                const subtitleElapsedMs = Math.max(0, nowMs - subtitle.startMs);
                const subtitleProgress = Math.min(1, subtitleElapsedMs / 250);
                const subtitleScale = subtitleStyleValues.animation === 'pop' ? 0.9 + subtitleProgress * 0.1 : 1;
                const subtitleOpacity = subtitleStyleValues.animation === 'pop' ? subtitleProgress : 1;
                const subtitleColor = subtitleStyleValues.animation === 'karaoke' ? subtitleStyleValues.highlightColor : subtitleStyleValues.color;
                const subtitleWidth = canvas.width * 0.88;
                const subtitleFontSize = Math.max(24, Math.round(subtitleStyleValues.fontSize * (Math.min(canvas.width, canvas.height) / 440)));
                const subtitleMetrics = measureOverlay(context, subtitle.text, subtitleWidth, subtitleFontSize, subtitleStyleValues.fontFamily);
                const subtitleDesiredY = subtitleStyleValues.position === 'top' ? canvas.height * 0.12 : subtitleStyleValues.position === 'middle' ? canvas.height * 0.45 : canvas.height * 0.78;
                const subtitleY = clampOverlayY(subtitleDesiredY, canvas.height, subtitleMetrics.height, subtitleMetrics.padding);
                context.save();
                context.translate(canvas.width / 2, subtitleY);
                context.scale(subtitleScale, subtitleScale);
                drawOverlay(context, subtitle.text, {
                    x: 0,
                    y: 0,
                    width: subtitleWidth,
                    fontSize: subtitleFontSize,
                    fontFamily: subtitleStyleValues.fontFamily,
                    color: subtitleColor,
                    background: subtitleStyleValues.backgroundOpacity > 0 ? subtitleStyleValues.background : 'transparent',
                    borderColor: subtitleStyleValues.outlineColor,
                    borderWidth: subtitleStyleValues.outlineWidth,
                    opacity: subtitleOpacity,
                });
                context.restore();
            }
            const currentHook = hook && nowMs >= hook.startMs && nowMs < hook.endMs ? hook : null;
            if (currentHook) {
                const hookState = hookVisualState(currentHook, nowMs - currentHook.startMs);
                const positionY = currentHook.position === 'bottom' ? canvas.height * 0.84 : currentHook.position === 'center' ? canvas.height * 0.46 : canvas.height * 0.12;
                context.save();
                context.translate(canvas.width / 2, positionY + hookState.translateY);
                context.scale(hookState.scale, hookState.scale);
                drawOverlay(context, currentHook.text, {
                    x: 0,
                    y: 0,
                    width: canvas.width * 0.9,
                    fontSize: Number(currentHook.fontSize) || Math.max(24, Math.round(canvas.width * 0.05)),
                    color: currentHook.color || '#ffffff',
                    background: currentHook.background || 'rgba(17, 17, 17, 0.8)',
                    opacity: hookState.opacity,
                });
                context.restore();
            }
            canvasVideoTrack?.requestFrame?.();
            onProgress(exportVideo.duration ? Math.min(1, exportVideo.currentTime / exportVideo.duration) : 0);
            if (!exportVideo.ended) {
                if (typeof exportVideo.requestVideoFrameCallback === 'function') {
                    scheduledFrameKind = 'video';
                    scheduledFrameId = exportVideo.requestVideoFrameCallback(() => {
                        scheduledFrameId = null;
                        draw();
                    });
                } else {
                    scheduledFrameKind = 'animation';
                    scheduledFrameId = requestAnimationFrame(() => {
                        scheduledFrameId = null;
                        draw();
                    });
                }
            }
        };

        const result = new Promise((resolve, reject) => {
            resolveRender = resolve;
            rejectRender = reject;
            recorder.addEventListener('dataavailable', (event) => {
                if (event.data?.size) chunks.push(event.data);
            });
            recorder.addEventListener('stop', () => finish());
            exportVideo.addEventListener('ended', () => recorder.state === 'recording' && recorder.stop(), { once: true });
            recorder.addEventListener('error', () => finish(new Error('Local video export failed.')));
            recorder.start();
            draw();
            exportVideo.play().catch(() => finish(new Error('The browser blocked local video playback for export.')));
        });

        return await result;
    } finally {
        if (scheduledFrameId !== null) {
            if (scheduledFrameKind === 'video' && typeof exportVideo.cancelVideoFrameCallback === 'function') exportVideo.cancelVideoFrameCallback(scheduledFrameId);
            else cancelAnimationFrame(scheduledFrameId);
        }
        stream?.getTracks().forEach((track) => track.stop());
        exportVideo.pause();
        exportVideo.removeAttribute('src');
        exportVideo.load();
        exportVideo.remove();
    }
}
