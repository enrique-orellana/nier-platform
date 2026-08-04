import { Trash2 } from 'lucide-react';

export default function SubtitleTrackPicker({ tracks = [], activeTrackId, onSelect, onRemove }) {
    return (
        <div className="flex flex-wrap gap-2" role="listbox" aria-label="Subtitle language">
            {tracks.map((track) => (
                <div key={track.id} className="flex items-stretch overflow-hidden rounded-lg">
                    <button
                        type="button"
                        role="option"
                        aria-selected={track.id === activeTrackId}
                        onClick={() => onSelect(track.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${track.id === activeTrackId
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'
                            }`}
                    >
                        {track.label || track.language}
                    </button>
                    {track.origin === 'translation' && onRemove && <button type="button" aria-label={`Delete ${track.label || track.language} translation`} title={`Delete ${track.label || track.language} translation`} onClick={() => onRemove(track.id)} className="border-y border-r border-red-400/20 bg-red-500/10 px-2 text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200"><Trash2 size={13} /></button>}
                </div>
            ))}
        </div>
    );
}
