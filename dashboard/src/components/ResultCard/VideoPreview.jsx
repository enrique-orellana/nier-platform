import React from 'react';
import { Loader2 } from 'lucide-react';

export default function VideoPreview({ 
    videoRef, 
    currentVideoUrl, 
    index, 
    isEditing, 
    isConvertingNativeShort, 
    isQualityImproving, 
    onPlay, 
    onPause, 
    clip 
}) {
    return (
        <div className="w-full bg-black relative shrink-0 aspect-[9/16] group/video">
            <video
                ref={videoRef}
                src={currentVideoUrl}
                controls
                className="w-full h-full object-cover"
                playsInline
                onPlay={() => {
                    const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
                    onPlay && onPlay(clip.start + currentTime);
                }}
                onPause={() => onPause && onPause()}
                onEnded={() => {
                    if (videoRef.current) {
                        videoRef.current.currentTime = 0;
                        videoRef.current.play();
                    }
                }}
            />
            <div className="absolute top-3 left-3 flex gap-2">
                <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md border border-white/10 uppercase tracking-wide">
                    Clip {index + 1}
                </span>
            </div>

            {/* Auto Edit Overlay if Processing */}
            {(isEditing || isConvertingNativeShort || isQualityImproving) && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 p-4 text-center">
                    <Loader2 size={32} className="text-primary animate-spin mb-3" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                        {isConvertingNativeShort
                            ? 'Converting to Native Short...'
                            : isQualityImproving
                                ? 'Improving Quality...'
                                : 'AI Magic in Progress...'}
                    </span>
                    <span className="text-[10px] text-zinc-400 mt-1">
                        {isConvertingNativeShort
                            ? 'Re-rendering to 1080x1920'
                            : isQualityImproving
                                ? 'Re-encoding without changing framing'
                                : 'Applying viral edits & zooms'}
                    </span>
                </div>
            )}
        </div>
    );
}
