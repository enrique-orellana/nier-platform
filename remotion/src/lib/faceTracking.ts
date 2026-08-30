import type { FaceTrackingCache, FaceTrackingRect } from "./types";

export const FACE_TRACKING_ALGORITHM_VERSION = "yolo-standard-v1";

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const validRect = (rect: unknown): rect is FaceTrackingRect => {
  if (!rect || typeof rect !== "object") return false;
  const value = rect as Partial<FaceTrackingRect>;
  const x = finite(value.x);
  const y = finite(value.y);
  const width = finite(value.width);
  const height = finite(value.height);
  return (
    x !== null &&
    y !== null &&
    width !== null &&
    height !== null &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
};

export const normalizeFaceTrackingCache = (
  value: unknown,
  durationSeconds?: number,
): FaceTrackingCache | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const cache = value as Partial<FaceTrackingCache>;
  if (
    typeof cache.cache_key !== "string" ||
    !cache.cache_key.trim() ||
    cache.algorithm_version !== FACE_TRACKING_ALGORITHM_VERSION ||
    typeof cache.source_fingerprint !== "string" ||
    !cache.source_fingerprint.trim()
  )
    return undefined;
  const start = finite(cache.source_start_seconds);
  const end = finite(cache.source_end_seconds);
  const width = finite(cache.source_width);
  const height = finite(cache.source_height);
  const duration = finite(durationSeconds);
  if (
    start === null ||
    end === null ||
    end <= start ||
    width === null ||
    height === null ||
    width < 1 ||
    height < 1 ||
    !cache.track ||
    !Array.isArray(cache.track.scenes)
  )
    return undefined;
  let previousEnd = 0;
  for (const scene of cache.track.scenes) {
    const sceneStart = finite(scene?.start_sec);
    const sceneEnd = finite(scene?.end_sec);
    if (
      sceneStart === null ||
      sceneEnd === null ||
      sceneStart < 0 ||
      sceneEnd <= sceneStart ||
      sceneStart < previousEnd ||
      (duration !== null && sceneEnd > duration + 0.05) ||
      !["TRACK", "GENERAL"].includes(scene?.strategy || "") ||
      !Array.isArray(scene?.keyframes) ||
      scene.keyframes.length === 0
    )
      return undefined;
    let previousTime = sceneStart;
    for (const keyframe of scene.keyframes) {
      const time = finite(keyframe?.time_sec);
      if (
        time === null ||
        time < sceneStart ||
        time > sceneEnd ||
        time < previousTime ||
        !validRect(keyframe?.rect)
      )
        return undefined;
      previousTime = time;
    }
    previousEnd = sceneEnd;
  }
  return cache as FaceTrackingCache;
};

export const faceTrackingRectangleAt = (
  cache: FaceTrackingCache | undefined,
  timeSeconds: number,
): FaceTrackingRect | undefined => {
  if (!cache?.track?.scenes?.length) return undefined;
  const time = Number(timeSeconds);
  if (!Number.isFinite(time)) return undefined;
  const scene = cache.track.scenes.find(
    (candidate, index) =>
      (candidate.start_sec <= time && time < candidate.end_sec) ||
      (index === cache.track.scenes.length - 1 && time === candidate.end_sec),
  );
  if (!scene?.keyframes?.length) return undefined;
  if (time <= scene.keyframes[0].time_sec) return scene.keyframes[0].rect;
  const last = scene.keyframes[scene.keyframes.length - 1];
  if (time >= last.time_sec) return last.rect;
  for (let index = 1; index < scene.keyframes.length; index += 1) {
    const left = scene.keyframes[index - 1];
    const right = scene.keyframes[index];
    if (time <= right.time_sec) {
      const span = right.time_sec - left.time_sec;
      const factor = span === 0 ? 0 : (time - left.time_sec) / span;
      return {
        x: left.rect.x + (right.rect.x - left.rect.x) * factor,
        y: left.rect.y + (right.rect.y - left.rect.y) * factor,
        width: left.rect.width + (right.rect.width - left.rect.width) * factor,
        height:
          left.rect.height + (right.rect.height - left.rect.height) * factor,
      };
    }
  }
  return last.rect;
};
