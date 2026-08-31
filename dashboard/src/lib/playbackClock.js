import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

export const DEFAULT_PLAYBACK_CLOCK_DURATION_MS = 30000;
export const DEFAULT_PLAYBACK_RATE = 1;

const finitePositive = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const resolveValue = (nextValue, currentValue) =>
  typeof nextValue === "function" ? nextValue(currentValue) : nextValue;

export const clampTimeMs = (value, durationMs) => {
  const duration = finitePositive(
    durationMs,
    DEFAULT_PLAYBACK_CLOCK_DURATION_MS,
  );
  const numericValue = Number(value);
  return clamp(Number.isFinite(numericValue) ? numericValue : 0, 0, duration);
};

export const frameFromTimeMs = (timeMs, durationMs, fps) => {
  const duration = finitePositive(
    durationMs,
    DEFAULT_PLAYBACK_CLOCK_DURATION_MS,
  );
  const framesPerSecond = finitePositive(fps, 30);
  const durationInFrames = Math.max(
    1,
    Math.round((duration / 1000) * framesPerSecond),
  );
  return Math.min(
    durationInFrames - 1,
    Math.max(
      0,
      Math.round((clampTimeMs(timeMs, duration) / 1000) * framesPerSecond),
    ),
  );
};

export const createPlaybackClockState = ({
  durationMs = DEFAULT_PLAYBACK_CLOCK_DURATION_MS,
  playheadMs = 0,
  isPlaying = false,
  isLooping = false,
  playbackRate = DEFAULT_PLAYBACK_RATE,
  seekRevision = 0,
} = {}) => {
  const normalizedDurationMs = finitePositive(
    durationMs,
    DEFAULT_PLAYBACK_CLOCK_DURATION_MS,
  );
  return {
    durationMs: normalizedDurationMs,
    playheadMs: clampTimeMs(playheadMs, normalizedDurationMs),
    isPlaying: Boolean(isPlaying),
    isLooping: Boolean(isLooping),
    playbackRate: finitePositive(playbackRate, DEFAULT_PLAYBACK_RATE),
    seekRevision: Math.max(0, Math.trunc(Number(seekRevision) || 0)),
  };
};

export const reducePlaybackClock = (state, action) => {
  switch (action.type) {
    case "set-playhead":
      return {
        ...state,
        playheadMs: clampTimeMs(
          resolveValue(action.value, state.playheadMs),
          state.durationMs,
        ),
      };
    case "seek":
      return {
        ...state,
        playheadMs: clampTimeMs(
          resolveValue(action.value, state.playheadMs),
          state.durationMs,
        ),
        seekRevision: state.seekRevision + 1,
      };
    case "set-duration": {
      const durationMs = finitePositive(
        resolveValue(action.value, state.durationMs),
        state.durationMs,
      );
      return {
        ...state,
        durationMs,
        playheadMs: Math.min(state.playheadMs, durationMs),
      };
    }
    case "set-playing":
      return {
        ...state,
        isPlaying: Boolean(resolveValue(action.value, state.isPlaying)),
      };
    case "set-looping":
      return {
        ...state,
        isLooping: Boolean(resolveValue(action.value, state.isLooping)),
      };
    case "set-rate":
      return {
        ...state,
        playbackRate: finitePositive(
          resolveValue(action.value, state.playbackRate),
          DEFAULT_PLAYBACK_RATE,
        ),
      };
    case "reset":
      return {
        ...state,
        playheadMs: 0,
        isPlaying: false,
        isLooping: false,
        playbackRate: DEFAULT_PLAYBACK_RATE,
        seekRevision: state.seekRevision + 1,
      };
    default:
      return state;
  }
};

const PlaybackClockContext = createContext(null);

export const PlaybackClockProvider = ({ clock, children }) =>
  React.createElement(
    PlaybackClockContext.Provider,
    { value: clock },
    children,
  );

export const usePlaybackClock = () => useContext(PlaybackClockContext);

export const usePlaybackClockState = ({
  initialDurationMs = DEFAULT_PLAYBACK_CLOCK_DURATION_MS,
  fps = 30,
} = {}) => {
  const [state, dispatch] = useReducer(
    reducePlaybackClock,
    createPlaybackClockState({ durationMs: initialDurationMs }),
  );
  const playheadRef = useRef(state.playheadMs);
  useEffect(() => {
    playheadRef.current = state.playheadMs;
  }, [state.playheadMs]);
  const normalizedFps = finitePositive(fps, 30);

  const setPlayheadMs = useCallback(
    (value) => dispatch({ type: "set-playhead", value }),
    [],
  );
  const setDurationMs = useCallback(
    (value) => dispatch({ type: "set-duration", value }),
    [],
  );
  const setIsPlaying = useCallback(
    (value) => dispatch({ type: "set-playing", value }),
    [],
  );
  const setIsLooping = useCallback(
    (value) => dispatch({ type: "set-looping", value }),
    [],
  );
  const setPlaybackRate = useCallback(
    (value) => dispatch({ type: "set-rate", value }),
    [],
  );
  const seekTo = useCallback((value) => dispatch({ type: "seek", value }), []);
  const resetPlayback = useCallback(() => dispatch({ type: "reset" }), []);

  return useMemo(
    () => ({
      ...state,
      fps: normalizedFps,
      currentFrame: frameFromTimeMs(
        state.playheadMs,
        state.durationMs,
        normalizedFps,
      ),
      playheadRef,
      setPlayheadMs,
      setDurationMs,
      setIsPlaying,
      setIsLooping,
      setPlaybackRate,
      seekTo,
      resetPlayback,
    }),
    [
      normalizedFps,
      resetPlayback,
      seekTo,
      setDurationMs,
      setIsLooping,
      setIsPlaying,
      setPlaybackRate,
      setPlayheadMs,
      state,
    ],
  );
};
