import React, { useEffect, useMemo, useRef } from 'react';
import { Player } from '@remotion/player';
import { ShortVideo } from '../remotion/compositions/ShortVideo';

/**
 * Wraps Remotion's Player component for real-time preview in modals.
 * Accepts the same ShortVideoProps interface as the Remotion composition.
 *
 * @param {object} props
 * @param {string} props.videoUrl - URL to the base clip video
 * @param {number} props.durationInSeconds - Video duration in seconds
 * @param {object|null} props.subtitles - SubtitleConfig or null
 * @param {object|null} props.hook - HookConfig or null
 * @param {object|null} props.effects - EffectsConfig or null
 * @param {string} [props.className] - Additional CSS classes
 */
export default function RemotionPreview({
    videoUrl,
    durationInSeconds = 30,
    fps = 30,
    width = 1080,
    height = 1920,
    subtitles = null,
    subtitleTracks = [],
    activeSubtitleTrackId = null,
    hook = null,
    effects = null,
    currentFrame = 0,
    className = '',
}) {
    const durationInFrames = Math.max(1, Math.round(durationInSeconds * fps));
    const playerRef = useRef(null);

    useEffect(() => {
        playerRef.current?.seekTo?.(Math.max(0, Math.min(durationInFrames - 1, Math.round(currentFrame))));
    }, [currentFrame, durationInFrames]);

    const inputProps = useMemo(
        () => ({
            videoUrl,
            durationInFrames,
            fps,
            width,
            height,
            subtitles,
            subtitleTracks,
            activeSubtitleTrackId,
            hook,
            effects,
        }),
        [videoUrl, durationInFrames, fps, width, height, subtitles, subtitleTracks, activeSubtitleTrackId, hook, effects]
    );

    return (
        <div className={`w-full h-full ${className}`}>
            <Player
                ref={playerRef}
                component={ShortVideo}
                inputProps={inputProps}
                durationInFrames={durationInFrames}
                fps={fps}
                compositionWidth={width}
                compositionHeight={height}
                style={{
                    width: '100%',
                    height: '100%',
                }}
                controls
                autoPlay
                loop
                acknowledgeRemotionLicense={true}
            />
        </div>
    );
}
