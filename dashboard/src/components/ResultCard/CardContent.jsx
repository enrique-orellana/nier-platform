import React from 'react';
import { Youtube, Video, Instagram } from 'lucide-react';

const formatSourceTime = (seconds) => {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainder = totalSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export default function CardContent({ clip, masterDuration }) {
    const hasSourceRange = Number.isFinite(Number(clip.start)) && Number.isFinite(Number(clip.end));

    return (
        <div className="flex-1 p-5 flex flex-col bg-[#121214] overflow-hidden min-w-0">
            <div className="mb-4">
                <h3 className="text-base font-bold text-white leading-tight line-clamp-2 mb-2 break-words" title={clip.video_title_for_youtube_short}>
                    {clip.video_title_for_youtube_short || "Viral Clip Generated"}
                </h3>
                <div className="flex flex-wrap gap-2 text-[10px] text-zinc-500 font-mono">
                    <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5 shrink-0">{Math.floor(clip.end - clip.start)}s</span>
                    <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5 shrink-0">#shorts</span>
                    <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5 shrink-0">#viral</span>
                </div>
                {hasSourceRange && (
                    <div data-testid="clip-source-range" className="mt-2 text-[10px] text-zinc-400 font-mono">
                        Start {formatSourceTime(clip.start)} · End {formatSourceTime(clip.end)}
                        {Number.isFinite(Number(masterDuration)) && Number(masterDuration) > 0
                            ? ` · Master ${formatSourceTime(masterDuration)}`
                            : ''}
                    </div>
                )}
            </div>

            {/* Scrollable Descriptions Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2 mb-4">
                {/* YouTube */}
                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-red-400 mb-1.5 uppercase tracking-wider">
                        <Youtube size={12} className="shrink-0" /> <span className="truncate">YouTube Title</span>
                    </div>
                    <p className="text-xs text-zinc-300 select-all break-words">
                        {clip.video_title_for_youtube_short || "Viral Short Video"}
                    </p>
                </div>

                {/* TikTok / IG */}
                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">
                        <Video size={12} className="text-cyan-400 shrink-0" />
                        <span className="text-zinc-500">/</span>
                        <Instagram size={12} className="text-pink-400 shrink-0" />
                        <span className="truncate">Caption</span>
                    </div>
                    <p className="text-xs text-zinc-300 line-clamp-3 hover:line-clamp-none transition-all cursor-pointer select-all break-words">
                        {clip.video_description_for_tiktok || clip.video_description_for_instagram}
                    </p>
                </div>
            </div>
        </div>
    );
}
