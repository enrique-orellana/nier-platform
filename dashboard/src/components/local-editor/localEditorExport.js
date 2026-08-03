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

const drawWrappedText = (context, text, x, y, maxWidth, lineHeight, paintLine = (line, lineX, lineY) => context.fillText(line, lineX, lineY)) => {
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
    output.forEach((line, index) => paintLine(line, x, y + index * lineHeight));
    return output.length;
};

const drawOverlay = (context, text, { x, y, width, fontSize, color, background, fontFamily = 'Arial, sans-serif', borderColor = '#000000', borderWidth = 0, opacity = 1 }) => {
    if (!text) return;
    context.save();
    context.globalAlpha = opacity;
    context.font = `700 ${fontSize}px ${fontFamily}, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    const lineHeight = fontSize * 1.2;
    const padding = fontSize * 0.35;
    const lines = String(text).split('\n');
    const maxWidth = width - padding * 2;
    const measured = lines.reduce((max, line) => Math.max(max, context.measureText(line).width), 0);
    const boxWidth = Math.min(width, measured + padding * 2);
    const boxHeight = lines.length * lineHeight + padding * 2;
    if (background && background !== 'transparent') {
        context.fillStyle = background;
        context.fillRect(x - boxWidth / 2, y - padding, boxWidth, boxHeight);
    }
    drawWrappedText(context, text, x, y, maxWidth, lineHeight, (line, lineX, lineY) => {
        if (borderWidth > 0) {
            context.strokeStyle = borderColor;
            context.lineWidth = borderWidth * 2;
            context.strokeText(line, lineX, lineY);
        }
        context.fillStyle = color;
        context.fillText(line, lineX, lineY);
    });
    context.restore();
};

export async function renderLocalVideo({ video, subtitleCues = [], subtitleStyle = DEFAULT_SUBTITLE_STYLE, hook = null, onProgress = () => {} }) {
    if (!video || typeof document === 'undefined') throw new Error('A local video is required.');
    if (typeof video.captureStream !== 'function') throw new Error('This browser cannot capture local video audio.');
    if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
        throw new Error('This browser cannot render a local video export.');
    }
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support local video recording.');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1920;
    const context = canvas.getContext('2d');
    const frameRate = 30;
    const canvasStream = canvas.captureStream(frameRate);
    const sourceStream = video.captureStream();
    const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...sourceStream.getAudioTracks(),
    ]);
    const isSupported = typeof MediaRecorder.isTypeSupported === 'function'
        ? (type) => MediaRecorder.isTypeSupported(type)
        : () => true;
    const mimeType = chooseRecordingMimeType(isSupported);
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const originalTime = video.currentTime;
    const originalPaused = video.paused;
    const originalMuted = video.muted;
    let animationFrame = null;
    let resolveRender;
    let rejectRender;
    let settled = false;

    const finish = (error = null) => {
        if (settled) return;
        settled = true;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        stream.getTracks().forEach((track) => track.stop());
        if (error) rejectRender(error);
        else resolveRender(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
    };

    const draw = () => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const nowMs = video.currentTime * 1000;
        const subtitle = activeCueAt(subtitleCues, nowMs);
        const subtitleStyleValues = subtitleVisualStyle(subtitleStyle);
        if (subtitle) {
            const subtitleElapsedMs = Math.max(0, nowMs - subtitle.startMs);
            const subtitleProgress = Math.min(1, subtitleElapsedMs / 250);
            const subtitleScale = subtitleStyleValues.animation === 'pop' ? 0.9 + subtitleProgress * 0.1 : 1;
            const subtitleOpacity = subtitleStyleValues.animation === 'pop' ? subtitleProgress : 1;
            const subtitleColor = subtitleStyleValues.animation === 'karaoke' ? subtitleStyleValues.highlightColor : subtitleStyleValues.color;
            context.save();
            context.translate(canvas.width / 2, subtitleStyleValues.position === 'top' ? canvas.height * 0.12 : subtitleStyleValues.position === 'middle' ? canvas.height * 0.45 : canvas.height * 0.78);
            context.scale(subtitleScale, subtitleScale);
            drawOverlay(context, subtitle.text, {
                x: 0,
                y: 0,
                width: canvas.width * 0.88,
                fontSize: Math.max(24, Math.round(subtitleStyleValues.fontSize * (canvas.width / 440))),
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
        onProgress(video.duration ? Math.min(1, video.currentTime / video.duration) : 0);
        if (!video.ended) animationFrame = requestAnimationFrame(draw);
    };

    const result = new Promise((resolve, reject) => {
        resolveRender = resolve;
        rejectRender = reject;
        recorder.addEventListener('dataavailable', (event) => {
            if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener('stop', () => finish());
        video.addEventListener('ended', () => recorder.state === 'recording' && recorder.stop(), { once: true });
        recorder.addEventListener('error', () => finish(new Error('Local video export failed.')));
        recorder.start();
        draw();
        video.play().catch(() => finish(new Error('The browser blocked local video playback for export.')));
    });

    try {
        return await result;
    } finally {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        video.currentTime = originalTime;
        video.muted = originalMuted;
        if (!originalPaused) video.play().catch(() => {});
    }
}
