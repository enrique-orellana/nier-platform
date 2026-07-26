export default function SubtitleTrackPicker({ tracks = [], activeTrackId, onSelect }) {
    return (
        <div className="flex flex-wrap gap-2" role="listbox" aria-label="Subtitle language">
            {tracks.map((track) => (
                <button
                    key={track.id}
                    type="button"
                    role="option"
                    aria-selected={track.id === activeTrackId}
                    onClick={() => onSelect(track.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${track.id === activeTrackId
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'
                        }`}
                >
                    {track.label || track.language}
                </button>
            ))}
        </div>
    );
}
