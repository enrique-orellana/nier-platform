import React, { useEffect, useMemo, useState } from 'react';
import { X, Save } from 'lucide-react';
import { getApiUrl } from '../../config';
import RemotionPreview from '../RemotionPreview';
import { manifestToEditorState, editorStateToManifest } from '../../editor/designcomboAdapter';
import TransportControls from './TransportControls';
import VersionHistory from './VersionHistory';

const proxyUrl = (url) => {
    if (!url || url.startsWith('blob:') || !url.startsWith('http')) return url;
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || 'video.mp4');
    return getApiUrl(`/api/video-proxy/${encodeURIComponent(name)}?url=${encodeURIComponent(url)}`);
};

export default function FullScreenEditor({ isOpen = true, jobId, clipIndex, clip = {}, initialVersion = null, initialManifest = null, onClose, onRendered }) {
    const [version, setVersion] = useState(initialVersion);
    const [manifest, setManifest] = useState(initialManifest);
    const [versions, setVersions] = useState(initialVersion ? [initialVersion] : []);
    const [editorState, setEditorState] = useState(() => manifestToEditorState(initialManifest || { timeline: { trim: { start_sec: 0, end_sec: clip.duration || 30 } }, layers: {}, subtitle_tracks: [] }, { fps: clip.output_fps || 30 }));
    const [currentFrame, setCurrentFrame] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [zoom, setZoom] = useState(1);
    const durationSeconds = editorState.durationSec || 30;
    const fps = editorState.fps || clip.output_fps || 30;

    useEffect(() => {
        if (!isOpen || initialManifest) return;
        let cancelled = false;
        const load = async () => {
            const historyResponse = await fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions`));
            const history = await historyResponse.json();
            const currentId = history.current_version_id || history.versions?.at(-1)?.version_id;
            if (!currentId) return;
            const versionResponse = await fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${currentId}`));
            const payload = await versionResponse.json();
            if (cancelled) return;
            setVersions(history.versions || []); setVersion(payload.version); setManifest(payload.manifest); setEditorState(manifestToEditorState(payload.manifest, { fps: clip.output_fps || 30 }));
        };
        load().catch(() => {});
        return () => { cancelled = true; };
    }, [clip.output_fps, clipIndex, initialManifest, isOpen, jobId]);

    const inputProps = useMemo(() => {
        const nextManifest = editorStateToManifest(editorState, manifest || initialManifest || {});
        return { videoUrl: proxyUrl(nextManifest.timeline?.source_video_url || clip.video_url), subtitles: nextManifest.layers?.subtitles || null, subtitleTracks: nextManifest.subtitle_tracks || [], activeSubtitleTrackId: nextManifest.active_subtitle_track_id || null, hook: nextManifest.layers?.hook || null, effects: nextManifest.layers?.effects || null };
    }, [clip.video_url, editorState, initialManifest, manifest]);

    if (!isOpen) return null;
    return <div className="fixed inset-0 z-[60] flex flex-col bg-[#0e0e11] text-white" data-testid="full-screen-editor"><header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-[#151519] px-4"><div className="flex items-center gap-3"><span className="text-sm font-bold">OpenShorts Editor</span><span className="text-xs text-zinc-500">{version ? `Version ${version.version_id.slice(0, 8)}` : 'Draft'}</span></div><button type="button" onClick={onClose} aria-label="close editor" className="rounded p-2 text-zinc-400 hover:bg-white/10 hover:text-white"><X size={16} /></button></header><div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_280px] grid-rows-[minmax(320px,1fr)_minmax(220px,38vh)]"><section className="row-span-2 overflow-auto border-r border-white/10 p-3" aria-label="Media Pool"><h2 className="mb-3 text-sm font-semibold">Media Pool</h2><div className="rounded-lg border border-white/10 bg-white/[.03] p-3 text-xs text-zinc-400">Source video<br /><span className="text-zinc-600">{inputProps.videoUrl || 'No source loaded'}</span></div></section><section className="min-w-0 border-b border-white/10 bg-black" aria-label="Viewer"><RemotionPreview videoUrl={inputProps.videoUrl} durationInSeconds={durationSeconds} fps={fps} width={clip.output_width || 1080} height={clip.output_height || 1920} subtitles={inputProps.subtitles} subtitleTracks={inputProps.subtitleTracks} activeSubtitleTrackId={inputProps.activeSubtitleTrackId} hook={inputProps.hook} effects={inputProps.effects} currentFrame={currentFrame} /></section><aside className="row-span-2 overflow-auto border-l border-white/10 p-3" aria-label="Inspector"><h2 className="mb-3 text-sm font-semibold">Inspector</h2><p className="text-xs text-zinc-500">Select a timeline item to edit its properties.</p><div className="mt-6"><h3 className="mb-2 text-xs font-semibold text-zinc-300">Version History</h3><VersionHistory versions={versions} currentVersionId={null} selectedVersionId={version?.version_id} onSelect={(next) => setVersion(next)} onBranch={() => {}} /></div></aside><section className="min-w-0 overflow-hidden" aria-label="Timeline"><TransportControls currentFrame={currentFrame} durationFrames={editorState.durationFrames} fps={fps} playing={playing} onPlayingChange={setPlaying} onFrameChange={setCurrentFrame} zoom={zoom} onZoomChange={setZoom} /><div className="h-[calc(100%-42px)] overflow-auto bg-[#111115] p-3"><div className="mb-2 flex min-w-[760px] items-center justify-between text-[10px] text-zinc-600"><span>00:00:00</span><span>{durationSeconds.toFixed(2)}s</span></div><div className="rounded border border-white/10 bg-black/20 p-4 text-xs text-zinc-500">DesignCombo timeline host</div></div></section></div><footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-white/10 bg-[#151519] px-4"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-zinc-400">Cancel</button><button type="button" onClick={() => onRendered?.(null)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold"><Save size={14} /> Save as new version</button></footer></div>;
}
