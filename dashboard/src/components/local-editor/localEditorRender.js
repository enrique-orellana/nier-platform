import { renderInBrowser } from '../../lib/renderInBrowser';

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
            captions: subtitleCues.map(({ text, startMs, endMs }) => ({ text: String(text || ''), startMs: Number(startMs), endMs: Number(endMs) })),
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
