import React, { useEffect, useState } from "react";
import { getAudioData, getWaveformPortion } from "@remotion/media-utils";

const audioDataCache = new Map();
const DEFAULT_SAMPLE_COUNT = 512;

export default function AudioWaveform({
  videoUrl = "",
  durationMs = 1,
  sampleCount = DEFAULT_SAMPLE_COUNT,
}) {
  const [state, setState] = useState({
    status: videoUrl ? "loading" : "empty",
    bars: [],
  });

  useEffect(() => {
    let active = true;
    const durationSeconds = Math.max(0.001, Number(durationMs || 0) / 1000);

    if (!videoUrl) {
      setState({ status: "empty", bars: [] });
      return () => {
        active = false;
      };
    }

    setState({ status: "loading", bars: [] });
    let audioDataPromise = audioDataCache.get(videoUrl);
    if (!audioDataPromise) {
      audioDataPromise = getAudioData(videoUrl).catch((error) => {
        audioDataCache.delete(videoUrl);
        throw error;
      });
      audioDataCache.set(videoUrl, audioDataPromise);
    }
    audioDataPromise
      .then((audioData) =>
        getWaveformPortion({
          audioData,
          startTimeInSeconds: 0,
          durationInSeconds: durationSeconds,
          numberOfSamples: Math.max(1, sampleCount),
          normalize: true,
        }),
      )
      .then((bars) => {
        if (!active) return;
        setState({ status: "ready", bars });
      })
      .catch(() => {
        if (active) setState({ status: "error", bars: [] });
      });

    return () => {
      active = false;
    };
  }, [durationMs, sampleCount, videoUrl]);

  return (
    <div
      data-testid="audio-waveform"
      aria-label="Audio waveform"
      className="pointer-events-none relative flex h-full items-center gap-px overflow-hidden px-1"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-1 top-1/2 h-px bg-muted-foreground/20"
      />
      {state.status === "ready" &&
        state.bars.map((bar) => {
          const amplitude = Math.max(
            0,
            Math.min(1, Number(bar.amplitude) || 0),
          );
          return (
            <span
              key={bar.index}
              data-testid="audio-waveform-bar"
              className="relative z-10 min-w-0 flex-1 rounded-[1px] bg-primary/60"
              style={{ height: `${amplitude * 84}%` }}
            />
          );
        })}
      {state.status !== "ready" && (
        <span className="px-2 text-[10px] text-muted-foreground">
          {state.status === "loading"
            ? "Loading waveform…"
            : state.status === "empty"
              ? "No audio source"
              : "Audio waveform unavailable"}
        </span>
      )}
    </div>
  );
}
