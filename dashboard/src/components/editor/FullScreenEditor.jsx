import React, { useEffect, useMemo, useState } from 'react';
import { X, Save } from 'lucide-react';
import { getApiUrl } from '../../config';
import RemotionPreview from '../RemotionPreview';
import { manifestToEditorState, editorStateToManifest } from '../../editor/designcomboAdapter';
import TransportControls from './TransportControls';
import VersionHistory from './VersionHistory';
import DesignComboTimeline from './DesignComboTimeline';
import MediaPool from './MediaPool';
import InspectorPanel from './InspectorPanel';
import SubtitleTranslationPanel from '../SubtitleTranslationPanel';
import { saveAndRenderVersion } from '../../editor/renderVersion';

const proxyUrl = (url) => {
    if (!url || url.startsWith('blob:') || !url.startsWith('http')) return url;
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || 'video.mp4');
    return getApiUrl(`/api/video-proxy/${encodeURIComponent(name)}?url=${encodeURIComponent(url)}`);
};

const defaultSubtitleTrackId = (nextManifest) => nextManifest?.active_subtitle_track_id || nextManifest?.subtitle_tracks?.[0]?.id || (nextManifest?.timeline?.transcript?.segments?.length ? 'original' : null);

export default function FullScreenEditor({ isOpen = true, jobId, clipIndex, clip = {}, initialVersion = null, initialManifest = null, onClose, onRendered }) {
    const [version, setVersion] = useState(initialVersion);
    const [manifest, setManifest] = useState(initialManifest);
    const [versions, setVersions] = useState(initialVersion ? [initialVersion] : []);
    const [editorState, setEditorState] = useState(() => manifestToEditorState(initialManifest || { timeline: { trim: { start_sec: 0, end_sec: clip.duration || 30 } }, layers: {}, subtitle_tracks: [] }, { fps: clip.output_fps || 30 }));
    const [currentFrame, setCurrentFrame] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [selectedItem, setSelectedItem] = useState(null);
    const [activeTrackId, setActiveTrackId] = useState(defaultSubtitleTrackId(initialManifest));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
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
            setVersions(history.versions || []); setVersion(payload.version); setManifest(payload.manifest); setEditorState(manifestToEditorState(payload.manifest, { fps: clip.output_fps || 30 })); setActiveTrackId(defaultSubtitleTrackId(payload.manifest));
        };
        load().catch(() => {});
        return () => { cancelled = true; };
    }, [clip.output_fps, clipIndex, initialManifest, isOpen, jobId]);

    const inputProps = useMemo(() => {
        const nextManifest = editorStateToManifest(editorState, manifest || initialManifest || {});
        return { videoUrl: proxyUrl(nextManifest.timeline?.source_video_url || clip.video_url), subtitles: nextManifest.layers?.subtitles || null, subtitleTracks: nextManifest.subtitle_tracks || [], activeSubtitleTrackId: nextManifest.active_subtitle_track_id || null, hook: nextManifest.layers?.hook || null, effects: nextManifest.layers?.effects || null };
    }, [clip.video_url, editorState, initialManifest, manifest]);

    const currentManifest = useMemo(() => editorStateToManifest(editorState, manifest || initialManifest || {}), [editorState, initialManifest, manifest]);
    const subtitleTracks = currentManifest.subtitle_tracks || [];
    const updateSelectedItem = (nextItem) => setEditorState((previous) => ({ ...previous, tracks: previous.tracks.map((track) => ({ ...track, items: track.items.map((item) => item.id === nextItem.id ? nextItem : item) })) }));
    const loadVersion = async (nextVersion) => {
        if (!nextVersion?.version_id) return;
        try {
            const response = await fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${nextVersion.version_id}`));
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || 'Unable to load version');
            setVersion(payload.version || nextVersion);
            setManifest(payload.manifest);
            setEditorState(manifestToEditorState(payload.manifest, { fps: clip.output_fps || 30 }));
            setActiveTrackId(defaultSubtitleTrackId(payload.manifest));
            setSelectedItem(null);
        } catch { /* keep the current draft active when a historical version cannot be loaded */ }
    };
    const translationPanel = <SubtitleTranslationPanel jobId={jobId} clipIndex={clipIndex} versionId={version?.version_id} tracks={subtitleTracks} activeTrackId={activeTrackId} onSelectTrack={setActiveTrackId} onTrackAdded={(track, nextManifest, mergedTracks) => {
        const next = nextManifest || { ...currentManifest, subtitle_tracks: mergedTracks || [...subtitleTracks, track] };
        setManifest(next);
        setEditorState(manifestToEditorState(next, { fps }));
        setActiveTrackId(track?.id || activeTrackId);
    }} />;
    const branchVersion = async (versionId) => {
        setBusy(true); setError(null);
        try {
            const response = await fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/branch`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: versionId }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || 'Branch failed.');
            setVersion(payload.version); setManifest(payload.manifest); setEditorState(manifestToEditorState(payload.manifest, { fps })); setActiveTrackId(defaultSubtitleTrackId(payload.manifest)); setSelectedItem(null);
        } catch (branchError) { setError(branchError.message); } finally { setBusy(false); }
    };
    const saveVersion = async () => {
        if (!version?.version_id || busy) return;
        setBusy(true); setError(null);
        const props = { ...inputProps, durationInFrames: editorState.durationFrames, fps, width: clip.output_width || 1080, height: clip.output_height || 1920 };
        const result = await saveAndRenderVersion({ jobId, clipIndex, manifest: { ...currentManifest, active_subtitle_track_id: activeTrackId }, parentVersionId: version.version_id, props });
        if (result.status === 'done') {
            const outputUrl = result.outputUrl?.startsWith('http') ? result.outputUrl : getApiUrl(result.outputUrl);
            onRendered?.(outputUrl);
            setVersion(result.version || version);
        } else setError(result.error || 'Render failed. The previous version is still active.');
        setBusy(false);
    };

    if (!isOpen) return null;
    return <div className="fixed inset-0 z-[60] flex flex-col bg-[#0e0e11] text-white" data-testid="full-screen-editor"><header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-[#151519] px-4"><div className="flex items-center gap-3"><span className="text-sm font-bold">OpenShorts Editor</span><span className="text-xs text-zinc-500">{version ? `Version ${version.version_id.slice(0, 8)}` : 'Draft'}</span></div><button type="button" onClick={onClose} aria-label="close editor" className="rounded p-2 text-zinc-400 hover:bg-white/10 hover:text-white"><X size={16} /></button></header><div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_280px] grid-rows-[minmax(320px,1fr)_minmax(220px,38vh)]"><section className="row-span-2 overflow-auto border-r border-white/10 p-3" aria-label="Media Pool"><h2 className="mb-3 text-sm font-semibold">Media Pool</h2><MediaPool sourceUrl={inputProps.videoUrl} versions={versions} tracks={subtitleTracks} onSelectVersion={loadVersion} onSelectTrack={setActiveTrackId} /></section><section className="min-w-0 border-b border-white/10 bg-black" aria-label="Viewer"><RemotionPreview videoUrl={inputProps.videoUrl} durationInSeconds={durationSeconds} fps={fps} width={clip.output_width || 1080} height={clip.output_height || 1920} subtitles={inputProps.subtitles} subtitleTracks={inputProps.subtitleTracks} activeSubtitleTrackId={activeTrackId || inputProps.activeSubtitleTrackId} hook={inputProps.hook} effects={inputProps.effects} currentFrame={currentFrame} playing={playing} onFrameChange={setCurrentFrame} onPlayingChange={setPlaying} /></section><aside className="row-span-2 overflow-auto border-l border-white/10 p-3" aria-label="Inspector"><h2 className="mb-3 text-sm font-semibold">Inspector</h2><InspectorPanel selectedItem={selectedItem} editorState={editorState} activeTrackId={activeTrackId} onTrackChange={setActiveTrackId} onItemChange={updateSelectedItem} translationPanel={translationPanel} /><div className="mt-6"><h3 className="mb-2 text-xs font-semibold text-zinc-300">Version History</h3><VersionHistory versions={versions} currentVersionId={version?.version_id} selectedVersionId={version?.version_id} onSelect={loadVersion} onBranch={branchVersion} /></div></aside><section className="min-w-0 overflow-hidden" aria-label="Timeline"><TransportControls currentFrame={currentFrame} durationFrames={editorState.durationFrames} fps={fps} playing={playing} onPlayingChange={setPlaying} onFrameChange={setCurrentFrame} zoom={zoom} onZoomChange={setZoom} /><div className="h-[calc(100%-42px)] overflow-auto bg-[#111115] p-3"><div className="mb-2 flex min-w-[760px] items-center justify-between text-[10px] text-zinc-600"><span>00:00:00</span><span>{durationSeconds.toFixed(2)}s</span></div><DesignComboTimeline state={editorState} onStateChange={setEditorState} onSelectItem={(item, track) => { setActiveTrackId(track.type === 'subtitle' ? track.id.replace(/^subtitles-/, '') : activeTrackId); setSelectedItem({ ...item, trackId: track.id }); }} playheadFrame={currentFrame} onSeek={(seconds) => setCurrentFrame(Math.round(seconds * fps))} zoom={zoom} /></div></section></div><footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-white/10 bg-[#151519] px-4"><span className="mr-auto max-w-[48%] truncate text-xs text-red-300" role="alert">{error}</span><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-zinc-400">Cancel</button><button type="button" onClick={saveVersion} disabled={busy || !version?.version_id} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"><Save size={14} /> {busy ? 'Rendering…' : 'Save as new version'}</button></footer></div>;
}
