import { Instagram, Video, Youtube } from 'lucide-react';

const finiteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const formatDuration = (seconds) => {
    const rounded = Math.max(0, Math.round(seconds));
    if (rounded < 60) return `${rounded}s`;
    const minutes = Math.floor(rounded / 60);
    const remainder = String(rounded % 60).padStart(2, '0');
    return `${minutes}m ${remainder}s`;
};

export default function ClipMetadataPanel({ clip = {} }) {
    const metadata = clip || {};
    const title = metadata.video_title_for_youtube_short || metadata.title || '';
    const caption = metadata.video_description_for_tiktok || metadata.video_description_for_instagram || metadata.description || '';
    const start = finiteNumber(metadata.start);
    const end = finiteNumber(metadata.end);
    const duration = end > start ? end - start : finiteNumber(metadata.duration);

    if (!title && !caption && duration <= 0) return null;

    return (
        <section className="min-w-0 rounded-xl border border-white/10 bg-white/[.02] p-3" aria-label="Clip metadata">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Clip details</p>
            {title && <h3 className="break-words text-sm font-bold leading-tight text-white">{title}</h3>}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
                {duration > 0 && <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">{formatDuration(duration)}</span>}
                <div className="flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-1.5 py-0.5" role="group" aria-label="Hashtags">
                    <span>#shorts</span>
                    <span>#viral</span>
                </div>
            </div>

            {title && <div className="mt-3 rounded-lg border border-white/5 bg-black/20 p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-red-400">
                    <Youtube size={11} className="shrink-0" />
                    <span>YouTube Title</span>
                </div>
                <p className="break-words text-[11px] leading-4 text-zinc-300">{title}</p>
            </div>}

            {caption && <div className="mt-2 rounded-lg border border-white/5 bg-black/20 p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                    <Video size={11} className="shrink-0 text-cyan-400" />
                    <span className="text-zinc-600">/</span>
                    <Instagram size={11} className="shrink-0 text-pink-400" />
                    <span>Caption</span>
                </div>
                <p className="break-words text-[11px] leading-4 text-zinc-300">{caption}</p>
            </div>}
        </section>
    );
}
