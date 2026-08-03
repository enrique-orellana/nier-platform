import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Film, Plus, RotateCcw, Upload, X } from 'lucide-react';
import LocalEditorTimeline from './LocalEditorTimeline';
import { parseSubtitleFile, serializeSrt } from './subtitleFormats';
import { activeCueAt, formatClock, renderLocalVideo } from './localEditorExport';
import {
    DEFAULT_SUBTITLE_STYLE,
    HOOK_ENTRANCE_OPTIONS,
    HOOK_SIZE_OPTIONS,
    HOOK_SIZE_SCALE,
    SUBTITLE_ANIMATION_OPTIONS,
    SUBTITLE_COLOR_PRESETS,
    SUBTITLE_FONT_OPTIONS,
    normalizeSubtitleStyle,
    subtitlePositionClass,
} from './localEditorStyles';

const DEFAULT_DURATION_MS = 30000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const clampCue = (cue, durationMs) => {
    const duration = Math.max(1, durationMs || DEFAULT_DURATION_MS);
    const startMs = clamp(cue.startMs, 0, Math.max(0, duration - 80));
    const endMs = clamp(cue.endMs, startMs + 80, duration);
    return { ...cue, startMs, endMs };
};

const outlineTextShadow = (width, color) => {
    const borderWidth = Math.max(0, Number(width) || 0);
    if (!borderWidth) return 'none';
    return [
        `${borderWidth}px 0 0 ${color}`,
        `-${borderWidth}px 0 0 ${color}`,
        `0 ${borderWidth}px 0 ${color}`,
        `0 -${borderWidth}px 0 ${color}`,
    ].join(', ');
};

const buttonChoiceClass = (selected) => `rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${selected ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[.06] text-zinc-400 hover:bg-white/10 hover:text-white'}`;

const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
};

function UploadState({ onFile, error }) {
    const inputRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const chooseFile = (file) => file && onFile(file);
    return (
        <div className="mx-auto flex min-h-[65vh] max-w-2xl items-center justify-center p-6">
            <div
                className={`w-full rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${dragging ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-white/15 bg-white/[.03] hover:border-white/30'}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept="video/*"
                    aria-label="Upload video"
                    className="hidden"
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-fuchsia-300">
                    <Upload size={26} />
                </div>
                <h2 className="text-xl font-semibold text-white">Upload a video to start editing</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">Your video stays in your browser. Nothing is uploaded to OpenShorts while you edit locally.</p>
                <button type="button" onClick={() => inputRef.current?.click()} className="mt-6 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-400">
                    Choose local video
                </button>
                <p className="mt-4 text-xs text-zinc-600">Drag and drop a playable MP4, WebM, or MOV file</p>
                {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
            </div>
        </div>
    );
}

function SubtitleInspector({ cue, onChange, onDelete }) {
    if (!cue) return <p className="text-xs text-zinc-500">Select a subtitle cue on the timeline to edit it.</p>;
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">Subtitle cue</h3>
                <button type="button" onClick={() => onDelete(cue.id)} className="text-zinc-500 hover:text-red-300" aria-label="Delete subtitle cue"><X size={14} /></button>
            </div>
            <label className="block text-xs text-zinc-400">Subtitle text<textarea aria-label="Subtitle text" rows={3} value={cue.text} onChange={(event) => onChange({ ...cue, text: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white outline-none focus:border-violet-400" /></label>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-400">Start (ms)<input aria-label="Subtitle start" type="number" value={cue.startMs} onChange={(event) => onChange({ ...cue, startMs: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
                <label className="text-xs text-zinc-400">End (ms)<input aria-label="Subtitle end" type="number" value={cue.endMs} onChange={(event) => onChange({ ...cue, endMs: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
            </div>
        </div>
    );
}

function SubtitleStyleInspector({ style, onChange, onRemove, hasCues }) {
    const current = normalizeSubtitleStyle(style);
    const update = (key, value) => onChange({ ...current, [key]: value });
    return (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">Subtitle style</h3>
                {hasCues && <button type="button" onClick={onRemove} className="text-xs text-red-300 hover:text-red-200">Remove Subtitles</button>}
            </div>
            <label className="block text-xs text-zinc-400">Subtitle font<select aria-label="Subtitle font" value={current.fontFamily} onChange={(event) => update('fontFamily', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white">{SUBTITLE_FONT_OPTIONS.map((font) => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}</select></label>
            <label className="block text-xs text-zinc-400">Subtitle position<select aria-label="Subtitle position" value={current.position} onChange={(event) => update('position', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-400">Subtitle font size<input aria-label="Subtitle font size" type="number" min="12" max="120" value={current.fontSize} onChange={(event) => update('fontSize', Math.max(12, Number(event.target.value) || 12))} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
                <label className="text-xs text-zinc-400">Subtitle outline width<input aria-label="Subtitle outline width" type="range" min="0" max="5" step="1" value={current.borderWidth} onChange={(event) => update('borderWidth', Number(event.target.value))} className="mt-3 w-full accent-violet-400" /><span className="block text-right text-[10px] text-zinc-500">{current.borderWidth}px</span></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-400">Subtitle text color<input aria-label="Subtitle text color" type="color" value={current.fontColor} onChange={(event) => update('fontColor', event.target.value)} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30" /></label>
                <label className="text-xs text-zinc-400">Subtitle highlight color<input aria-label="Subtitle highlight color" type="color" value={current.highlightColor} onChange={(event) => update('highlightColor', event.target.value)} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30" /></label>
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Subtitle text color presets">{SUBTITLE_COLOR_PRESETS.map((color) => <button key={color} type="button" aria-label={`Use subtitle color ${color}`} onClick={() => update('fontColor', color)} className={`h-6 w-6 rounded-full border-2 ${current.fontColor.toUpperCase() === color ? 'border-white' : 'border-white/20'}`} style={{ backgroundColor: color }} />)}</div>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-400">Subtitle outline color<input aria-label="Subtitle outline color" type="color" value={current.borderColor} onChange={(event) => update('borderColor', event.target.value)} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30" /></label>
                <label className="text-xs text-zinc-400">Subtitle background color<input aria-label="Subtitle background color" type="color" value={current.bgColor} onChange={(event) => update('bgColor', event.target.value)} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30" /></label>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" aria-label="Subtitle background" checked={current.bgOpacity > 0} onChange={(event) => update('bgOpacity', event.target.checked ? 0.5 : 0)} className="accent-violet-400" />Background box</label>
            <label className="block text-xs text-zinc-400">Subtitle background opacity<input aria-label="Subtitle background opacity" type="range" min="0" max="1" step="0.05" value={current.bgOpacity} onChange={(event) => update('bgOpacity', Number(event.target.value))} className="mt-2 w-full accent-violet-400" /><span className="block text-right text-[10px] text-zinc-500">{Math.round(current.bgOpacity * 100)}%</span></label>
            <div>
                <span className="text-xs text-zinc-400">Subtitle animation</span>
                <div className="mt-1 grid grid-cols-2 gap-2">{SUBTITLE_ANIMATION_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => update('animation', option.value)} className={buttonChoiceClass(current.animation === option.value)}>{option.label}</button>)}</div>
            </div>
            {!hasCues && <p className="text-[11px] text-zinc-500">Import subtitles to enable this style.</p>}
        </div>
    );
}

function HookInspector({ hook, onChange, onRemove }) {
    if (!hook) return <p className="text-xs text-zinc-500">Add a hook to place a bold opening message over the video.</p>;
    return (
        <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Viral hook</h3>
            <label className="block text-xs text-zinc-400">Hook text<input aria-label="Hook text" value={hook.text} onChange={(event) => onChange({ ...hook, text: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-400">Start (ms)<input aria-label="Hook start" type="number" value={hook.startMs} onChange={(event) => onChange({ ...hook, startMs: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
                <label className="text-xs text-zinc-400">End (ms)<input aria-label="Hook end" type="number" value={hook.endMs} onChange={(event) => onChange({ ...hook, endMs: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
            </div>
            <label className="block text-xs text-zinc-400">Position<select aria-label="Hook position" value={hook.position} onChange={(event) => onChange({ ...hook, position: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
            <div>
                <span className="text-xs text-zinc-400">Size</span>
                <div className="mt-1 grid grid-cols-3 gap-2">{HOOK_SIZE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => onChange({ ...hook, size: option.value })} className={buttonChoiceClass((hook.size || 'M') === option.value)}>{option.label}</button>)}</div>
            </div>
            <div>
                <span className="text-xs text-zinc-400">Entrance</span>
                <div className="mt-1 grid grid-cols-2 gap-2">{HOOK_ENTRANCE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => onChange({ ...hook, entranceAnimation: option.value })} className={buttonChoiceClass((hook.entranceAnimation || 'spring') === option.value)}>{option.label}</button>)}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-zinc-400">Text color<input aria-label="Hook text color" type="color" value={hook.color} onChange={(event) => onChange({ ...hook, color: event.target.value })} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30" /></label>
                <label className="text-xs text-zinc-400">Size<input aria-label="Hook font size" type="number" min="12" max="160" value={hook.fontSize} onChange={(event) => onChange({ ...hook, fontSize: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
                <label className="text-xs text-zinc-400">Background<input aria-label="Hook background" type="color" value={hook.background} onChange={(event) => onChange({ ...hook, background: event.target.value })} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30" /></label>
            </div>
            <button type="button" onClick={onRemove} className="w-full rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10">Remove Hook</button>
        </div>
    );
}

export default function LocalEditorTab() {
    const videoRef = useRef(null);
    const objectUrlRef = useRef('');
    const subtitleInputRef = useRef(null);
    const [videoFile, setVideoFile] = useState(null);
    const [videoUrl, setVideoUrl] = useState('');
    const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [subtitleCues, setSubtitleCues] = useState([]);
    const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_SUBTITLE_STYLE);
    const [hook, setHook] = useState(null);
    const [selected, setSelected] = useState(null);
    const [pendingSubtitle, setPendingSubtitle] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => () => {
        if (objectUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrlRef.current);
    }, []);

    const selectedCue = useMemo(() => {
        if (!selected) return null;
        if (selected.type === 'hook') return hook;
        return subtitleCues.find((cue) => cue.id === selected.id) || null;
    }, [hook, selected, subtitleCues]);

    const loadVideo = (file) => {
        if (!file?.type?.startsWith('video/')) {
            setError('Please choose a playable video file.');
            return;
        }
        const nextUrl = URL.createObjectURL(file);
        if (objectUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = nextUrl;
        setVideoFile(file);
        setVideoUrl(nextUrl);
        setDurationMs(DEFAULT_DURATION_MS);
        setPlayheadMs(0);
        setError('');
    };

    const handleMetadata = () => {
        const nextDuration = Math.max(1, Math.round((videoRef.current?.duration || 30) * 1000));
        setDurationMs(nextDuration);
        setSubtitleCues((current) => current.map((cue) => clampCue(cue, nextDuration)));
        setHook((current) => current ? clampCue(current, nextDuration) : current);
    };

    const updateSubtitle = (cue) => setSubtitleCues((current) => current.map((item) => item.id === cue.id ? clampCue(cue, durationMs) : item));
    const updateHook = (nextHook) => setHook(clampCue(nextHook, durationMs));

    const handleTimelineSelect = (cue, type) => setSelected({ id: cue.id, type });
    const handleTimelineChange = (cue, type) => type === 'hook' ? updateHook(cue) : updateSubtitle(cue);

    const importSubtitleFile = async (file) => {
        if (!file) return;
        try {
            if (subtitleCues.length && !window.confirm('Replace the current subtitle track?')) return;
            const cues = parseSubtitleFile(file.name, await file.text());
            setSubtitleCues(cues.map((cue) => clampCue(cue, durationMs)));
            setPendingSubtitle(null);
            if (subtitleInputRef.current) subtitleInputRef.current.value = '';
            setSelected(null);
            setError('');
        } catch (importError) {
            setError(importError.message || 'Could not import subtitles.');
        }
    };

    const handleImport = () => {
        if (pendingSubtitle) {
            importSubtitleFile(pendingSubtitle);
            return;
        }
        subtitleInputRef.current?.click();
    };

    const addHook = () => {
        const nextHook = { id: 'hook', text: 'Your viral hook', startMs: 0, endMs: Math.min(2500, durationMs), position: 'top', size: 'M', entranceAnimation: 'spring', color: '#ffffff', fontSize: 48, background: '#111111' };
        setHook(nextHook);
        setSelected({ id: 'hook', type: 'hook' });
    };

    const removeHook = () => {
        setHook(null);
        setSelected((current) => current?.type === 'hook' ? null : current);
    };

    const removeSubtitles = () => {
        if (!window.confirm('Remove all subtitles?')) return;
        setSubtitleCues([]);
        setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
        setSelected((current) => current?.type === 'subtitle' ? null : current);
    };

    const handleSeek = (nextMs) => {
        setPlayheadMs(nextMs);
        if (videoRef.current) videoRef.current.currentTime = nextMs / 1000;
    };

    const exportSubtitles = () => downloadBlob(new Blob([serializeSrt(subtitleCues)], { type: 'application/x-subrip' }), 'openshorts-subtitles.srt');

    const exportVideo = async () => {
        setBusy(true);
        setProgress(0);
        setError('');
        try {
            const blob = await renderLocalVideo({ video: videoRef.current, subtitleCues, subtitleStyle, hook, onProgress: setProgress });
            downloadBlob(blob, 'openshorts-local-editor.webm');
        } catch (exportError) {
            setError(exportError.message || 'Could not export this video locally.');
        } finally {
            setBusy(false);
        }
    };

    const reset = () => {
        videoRef.current?.pause();
        if (objectUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
        setVideoFile(null);
        setVideoUrl('');
        setSubtitleCues([]);
        setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
        setHook(null);
        setSelected(null);
        setPendingSubtitle(null);
        setPlayheadMs(0);
        setProgress(0);
        setError('');
    };

    if (!videoFile) {
        return <div className="h-full overflow-y-auto bg-[#0d0d0f] text-white"><div className="border-b border-white/10 px-6 py-5"><h1 className="text-2xl font-bold">Local Editor</h1><p className="mt-1 text-sm text-zinc-500">Edit local videos, subtitles, and viral hooks in your browser.</p></div><UploadState onFile={loadVideo} error={error} /></div>;
    }

    const activeSubtitle = activeCueAt(subtitleCues, playheadMs);
    const activeHook = hook && playheadMs >= hook.startMs && playheadMs < hook.endMs ? hook : null;
    const previewSubtitleStyle = normalizeSubtitleStyle(subtitleStyle);
    const hookElapsedMs = activeHook ? Math.max(0, playheadMs - activeHook.startMs) : 0;
    const hookSizeScale = activeHook ? (HOOK_SIZE_SCALE[activeHook.size] || HOOK_SIZE_SCALE.M) : 1;
    const hookEntranceStyle = activeHook?.entranceAnimation === 'fade'
        ? { opacity: Math.min(1, hookElapsedMs / 500) }
        : activeHook?.entranceAnimation === 'slide-up'
            ? { opacity: Math.min(1, hookElapsedMs / 500), transform: `translateY(${Math.max(0, 24 - hookElapsedMs / 20)}px)` }
            : activeHook?.entranceAnimation === 'spring'
                ? { opacity: Math.min(1, hookElapsedMs / 250), transform: `scale(${0.82 + Math.min(1, hookElapsedMs / 350) * 0.18})` }
                : {};

    return (
        <div className="h-full overflow-y-auto bg-[#0d0d0f] text-white">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
                <div><h1 className="text-2xl font-bold">Local Editor</h1><p className="mt-1 text-sm text-zinc-500">{videoFile.name} · local-only editing</p></div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={exportVideo} disabled={busy} className="flex items-center gap-2 rounded-lg bg-fuchsia-500 px-3 py-2 text-xs font-semibold hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"><Film size={14} />{busy ? `Exporting ${Math.round(progress * 100)}%` : 'Export Video'}</button>
                    <button type="button" onClick={exportSubtitles} disabled={busy || !subtitleCues.length} className="flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"><Download size={14} />Export Subtitles</button>
                    <button type="button" onClick={reset} disabled={busy} aria-label="Reset" className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50"><RotateCcw size={14} />Reset</button>
                </div>
            </div>
            {error && <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
            <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                <main className="min-w-0 space-y-5">
                    <div className="mx-auto max-w-[440px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
                        <div className="relative aspect-[9/16]">
                            <video ref={videoRef} src={videoUrl} controls className="h-full w-full object-contain" onLoadedMetadata={handleMetadata} onTimeUpdate={(event) => setPlayheadMs(event.currentTarget.currentTime * 1000)} />
                            <div className="pointer-events-none absolute inset-0">
                                {activeHook && <div className={`absolute left-1/2 w-[88%] -translate-x-1/2 rounded-lg px-3 py-2 text-center font-bold shadow-lg ${activeHook.position === 'top' ? 'top-[8%]' : activeHook.position === 'bottom' ? 'bottom-[18%]' : 'top-1/2 -translate-y-1/2'}`} style={{ color: activeHook.color, backgroundColor: activeHook.background, fontSize: `${Math.max(14, (activeHook.fontSize / 2.6) * hookSizeScale)}px`, ...hookEntranceStyle }}>{activeHook.text}</div>}
                                {activeSubtitle && <div className={`absolute left-1/2 w-[88%] -translate-x-1/2 rounded-lg px-3 py-2 text-center font-semibold shadow-lg ${subtitlePositionClass(previewSubtitleStyle.position)}`} style={{ fontFamily: previewSubtitleStyle.fontFamily, color: previewSubtitleStyle.fontColor, fontSize: `${Math.max(12, previewSubtitleStyle.fontSize / 1.6)}px`, textShadow: outlineTextShadow(previewSubtitleStyle.borderWidth, previewSubtitleStyle.borderColor), backgroundColor: previewSubtitleStyle.bgOpacity > 0 ? `rgba(0, 0, 0, ${previewSubtitleStyle.bgOpacity})` : 'transparent' }}>{activeSubtitle.text}</div>}
                            </div>
                        </div>
                    </div>
                    <LocalEditorTimeline durationMs={durationMs} subtitleCues={subtitleCues} hook={hook} selectedId={selected?.id} onSelect={handleTimelineSelect} onChange={handleTimelineChange} playheadMs={playheadMs} onSeek={handleSeek} />
                </main>
                <aside className="space-y-4">
                    <section className="rounded-xl border border-white/10 bg-white/[.02] p-4">
                        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Subtitles</h2><FileText size={16} className="text-violet-300" /></div>
                        <input ref={subtitleInputRef} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" aria-label="Subtitle file" className="hidden" onChange={(event) => { const file = event.target.files?.[0] || null; setPendingSubtitle(file); importSubtitleFile(file); }} />
                        <button type="button" onClick={handleImport} className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"><Upload size={14} />Import subtitles</button>
                        <p className="mt-2 text-[11px] leading-5 text-zinc-500">Import timed .srt or .vtt files, then edit every cue directly on the timeline.</p>
                        {pendingSubtitle && <p className="mt-2 truncate text-xs text-violet-300">Ready: {pendingSubtitle.name}</p>}
                        <SubtitleStyleInspector style={subtitleStyle} onChange={setSubtitleStyle} onRemove={removeSubtitles} hasCues={subtitleCues.length > 0} />
                    </section>
                    <section className="rounded-xl border border-white/10 bg-white/[.02] p-4">
                        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Viral Hook</h2><button type="button" onClick={addHook} className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"><Plus size={12} />{hook ? 'Reset hook' : 'Add Viral Hook'}</button></div>
                        {selected?.type === 'hook' ? <HookInspector hook={selectedCue} onChange={updateHook} onRemove={removeHook} /> : <HookInspector hook={null} onChange={updateHook} onRemove={removeHook} />}
                    </section>
                    <section className="rounded-xl border border-white/10 bg-white/[.02] p-4">
                        {selected?.type === 'subtitle' ? <SubtitleInspector cue={selectedCue} onChange={updateSubtitle} onDelete={(id) => { setSubtitleCues((current) => current.filter((cue) => cue.id !== id)); setSelected(null); }} /> : <p className="text-xs text-zinc-500">Select a subtitle cue or the hook track to edit its properties.</p>}
                    </section>
                    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-500"><span>Playhead</span><span className="font-mono text-zinc-300">{formatClock(playheadMs)} / {formatClock(durationMs)}</span></div>
                </aside>
            </div>
        </div>
    );
}
