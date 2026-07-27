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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

            const translationId = payload.translationId;
            if (!translationId) throw new Error('Translation service did not return a job id.');

            let statusPayload = payload;
            while (!['done', 'error', 'failed'].includes(statusPayload.status)) {
                const statusResponse = await fetch(getApiUrl(`/api/translation/${translationId}`));
                statusPayload = await statusResponse.json();
                if (!statusResponse.ok) throw new Error(statusPayload.detail || 'Unable to read translation status.');
                if (!['done', 'error', 'failed'].includes(statusPayload.status)) await sleep(1000);
            }
            if (statusPayload.status !== 'done') throw new Error(statusPayload.error || 'Subtitle translation failed.');

            const mergedTracks = [...tracks.filter((track) => track.id !== statusPayload.track?.id), statusPayload.track].filter(Boolean);
            onTrackAdded(statusPayload.track, undefined, mergedTracks);
        } catch (translationError) {
            setError(translationError.message);
        } finally {
            setIsTranslating(false);
        }
    };

    return (
        <section className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden flex flex-col shadow-sm" aria-label="Subtitle translation">
            <div className="bg-white/[0.03] px-4 py-3 border-b border-white/5 flex items-center gap-3">
                <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400">
                    <Languages size={16} strokeWidth={2.5} />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white tracking-wide">Translate Track</h3>
                    <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{sourceCueCount} cues • audio intact</p>
                </div>
            </div>
            
            <div className="p-4 space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                        <span>Source Track</span>
                        <span className="text-zinc-400">{(sourceLanguage || 'unknown').toUpperCase()}</span>
                    </div>
                    <SubtitleTrackPicker tracks={tracks} activeTrackId={activeTrackId} onSelect={onSelectTrack} />
                </div>
                
                <div className="space-y-2">
                    <label htmlFor="target-language" className="block text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                        Target Language
                    </label>
                    <select
                        id="target-language"
                        value={targetLanguage}
                        onChange={(event) => setTargetLanguage(event.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-200 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all appearance-none cursor-pointer"
                        disabled={isTranslating}
                        aria-label="Target language"
                    >
                        {Object.entries(LANGUAGES).map(([code, name]) => (
                            <option key={code} value={code} disabled={code === sourceLanguage} className="bg-zinc-900 text-white">
                                {name}{code === sourceLanguage ? ' (source)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
                
                <button 
                    type="button" 
                    onClick={translate} 
                    disabled={isTranslating || !versionId || !sourceCueCount || targetLanguage === sourceLanguage} 
                    className="w-full relative overflow-hidden rounded-lg bg-gradient-to-b from-cyan-400 to-cyan-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_0_15px_rgba(34,211,238,0.2)] transition-all hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.4)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:grayscale group" 
                    aria-label="Translate entire track"
                >
                    <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative flex items-center justify-center gap-2">
                        {isTranslating ? <Loader2 size={16} className="animate-spin" /> : <Languages size={16} />}
                        <span>Translate Track</span>
                    </div>
                </button>
                
                {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 mt-4">
                        <p className="text-xs font-medium text-red-400 text-center" role="alert">{error}</p>
                    </div>
                )}
            </div>
        </section>
    );
}
