import { useEffect, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { getApiUrl } from '../config';
import SubtitleTrackPicker from './SubtitleTrackPicker';

const LANGUAGES = {
    en: 'English',
    es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
    pl: 'Polish', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
    ar: 'Arabic', ru: 'Russian', tr: 'Turkish', nl: 'Dutch', sv: 'Swedish',
    id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', uk: 'Ukrainian', el: 'Greek',
};

export default function SubtitleTranslationPanel({
    jobId,
    clipIndex,
    versionId,
    tracks,
    activeTrackId,
    aiHeaders = {},
    onTrackAdded,
    onSelectTrack,
}) {
    const [targetLanguage, setTargetLanguage] = useState('es');
    const [isTranslating, setIsTranslating] = useState(false);
    const [error, setError] = useState(null);
    const source = tracks.find((track) => track.id === activeTrackId) || tracks[0];
    const sourceLanguage = source?.language?.toLowerCase();
    const sourceCueCount = (source?.cues || source?.captions || []).length;

    useEffect(() => {
        setTargetLanguage(sourceLanguage === 'en' ? 'es' : 'en');
    }, [sourceLanguage]);

    const translate = async () => {
        setIsTranslating(true);
        setError(null);
        try {
            const response = await fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${versionId}/subtitle-tracks/translate`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...aiHeaders },
                body: JSON.stringify({ target_language: targetLanguage, source_track_id: source?.id || 'original', tracks }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || 'Subtitle translation failed.');
            const mergedTracks = [...tracks.filter((track) => track.id !== payload.track?.id), payload.track].filter(Boolean);
            const mergedManifest = payload.manifest ? { ...payload.manifest, subtitle_tracks: [...(payload.manifest.subtitle_tracks || []).filter((track) => track.id !== payload.track?.id), payload.track].filter(Boolean) } : undefined;
            onTrackAdded(payload.track, mergedManifest, mergedTracks);
        } catch (translationError) {
            setError(translationError.message);
        } finally {
            setIsTranslating(false);
        }
    };

    return (
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4" aria-label="Subtitle translation">
            <div className="flex items-center gap-2">
                <Languages size={16} className="text-cyan-400" />
                <div>
                    <h3 className="text-sm font-semibold text-white">Subtitle languages</h3>
                    <p className="text-[11px] text-zinc-500">Translates all {sourceCueCount} cues in the selected track. Audio stays unchanged.</p>
                </div>
            </div>
            <SubtitleTrackPicker tracks={tracks} activeTrackId={activeTrackId} onSelect={onSelectTrack} />
            <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2 text-xs">
                <span className="text-zinc-500">Source track</span>
                <span className="ml-2 font-semibold text-zinc-200">{(sourceLanguage || 'unknown').toUpperCase()}</span>
            </div>
            <p className="text-[11px] leading-4 text-zinc-500">Translate all {sourceCueCount} cues in this track. Timings and audio stay unchanged.</p>
            <div className="space-y-2">
                <label htmlFor="target-language" className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Translate to</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                <select
                    id="target-language"
                    value={targetLanguage}
                    onChange={(event) => setTargetLanguage(event.target.value)}
                    className="input-field min-w-0 flex-1"
                    disabled={isTranslating}
                    aria-label="Target language"
                >
                    {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code} disabled={code === sourceLanguage}>{name}{code === sourceLanguage ? ' (source)' : ''}</option>)}
                </select>
                <button type="button" onClick={translate} disabled={isTranslating || !versionId || !sourceCueCount || targetLanguage === sourceLanguage} className="btn-primary flex items-center justify-center gap-2 px-3 sm:min-w-[180px]" aria-label="Translate entire track">
                    {isTranslating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                    Translate entire track
                </button>
                </div>
            </div>
            {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
        </section>
    );
}
