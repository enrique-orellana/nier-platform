import { getApiUrl } from "../config";

export const FACE_TRACKING_ALGORITHM_VERSION = "yolo-standard-v1";

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const validRect = (rect) => {
  if (!isRecord(rect)) return false;
  const values = [rect.x, rect.y, rect.width, rect.height].map(finiteNumber);
  if (values.some((value) => value === null)) return false;
  const [x, y, width, height] = values;
  return (
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
};

const validTrack = (track, durationSeconds) => {
  if (!isRecord(track) || !Array.isArray(track.scenes)) return false;
  let previousEnd = 0;
  for (const scene of track.scenes) {
    if (!isRecord(scene) || !["TRACK", "GENERAL"].includes(scene.strategy))
      return false;
    const start = finiteNumber(scene.start_sec);
    const end = finiteNumber(scene.end_sec);
    if (
      start === null ||
      end === null ||
      start < 0 ||
      end <= start ||
      start < previousEnd ||
      end > durationSeconds + 0.05 ||
      !Array.isArray(scene.keyframes) ||
      scene.keyframes.length === 0
    )
      return false;
    let previousTime = start;
    for (const keyframe of scene.keyframes) {
      const time = finiteNumber(keyframe?.time_sec);
      if (
        time === null ||
        time < start ||
        time > end ||
        time < previousTime ||
        !validRect(keyframe.rect)
      )
        return false;
      previousTime = time;
    }
    previousEnd = end;
  }
  return track.scenes.length > 0;
};

export const normalizeFaceTrackingCache = (
  cache,
  {
    durationMs,
    sourceStartSeconds,
    sourceEndSeconds,
    sourceWidth,
    sourceHeight,
  } = {},
) => {
  if (!isRecord(cache)) return undefined;
  if (
    typeof cache.cache_key !== "string" ||
    !cache.cache_key.trim() ||
    cache.algorithm_version !== FACE_TRACKING_ALGORITHM_VERSION ||
    typeof cache.source_fingerprint !== "string" ||
    !cache.source_fingerprint.trim()
  )
    return undefined;

  const cacheStart = finiteNumber(cache.source_start_seconds);
  const cacheEnd = finiteNumber(cache.source_end_seconds);
  const cacheWidth = finiteNumber(cache.source_width);
  const cacheHeight = finiteNumber(cache.source_height);
  const expectedStart = finiteNumber(sourceStartSeconds);
  const expectedEnd = finiteNumber(sourceEndSeconds);
  const expectedWidth = finiteNumber(sourceWidth);
  const expectedHeight = finiteNumber(sourceHeight);
  if (
    cacheStart === null ||
    cacheEnd === null ||
    cacheEnd <= cacheStart ||
    (expectedStart !== null && Math.abs(cacheStart - expectedStart) > 0.01) ||
    (expectedEnd !== null && Math.abs(cacheEnd - expectedEnd) > 0.01) ||
    cacheWidth === null ||
    cacheHeight === null ||
    cacheWidth < 1 ||
    cacheHeight < 1 ||
    (expectedWidth !== null && cacheWidth !== expectedWidth) ||
    (expectedHeight !== null && cacheHeight !== expectedHeight)
  )
    return undefined;

  const durationSeconds =
    finiteNumber(durationMs) !== null
      ? Math.max(0.001, Number(durationMs) / 1000)
      : cacheEnd - cacheStart;
  if (!validTrack(cache.track, durationSeconds)) return undefined;
  return cache;
};

export const clearFaceTrackingCache = (segment) => {
  if (!segment) return segment;
  const next = { ...segment };
  delete next.face_tracking_cache;
  return next;
};

export const isFaceTrackingEnabled = (segment) =>
  segment?.format === "standard" && segment?.face_tracking_enabled === true;

export const getUsableFaceTrackingCache = (segment, options) =>
  isFaceTrackingEnabled(segment)
    ? normalizeFaceTrackingCache(segment.face_tracking_cache, options)
    : undefined;

export const faceTrackingRectangleAt = (cache, timeSeconds) => {
  const scenes = cache?.track?.scenes;
  const time = Number(timeSeconds);
  if (!Array.isArray(scenes) || !scenes.length || !Number.isFinite(time))
    return undefined;
  const scene = scenes.find(
    (candidate, index) =>
      (Number(candidate.start_sec) <= time &&
        time < Number(candidate.end_sec)) ||
      (index === scenes.length - 1 && time === Number(candidate.end_sec)),
  );
  if (!Array.isArray(scene?.keyframes) || !scene.keyframes.length)
    return undefined;
  if (time <= Number(scene.keyframes[0].time_sec))
    return scene.keyframes[0].rect;
  const last = scene.keyframes[scene.keyframes.length - 1];
  if (time >= Number(last.time_sec)) return last.rect;
  for (let index = 1; index < scene.keyframes.length; index += 1) {
    const left = scene.keyframes[index - 1];
    const right = scene.keyframes[index];
    if (time <= Number(right.time_sec)) {
      const span = Number(right.time_sec) - Number(left.time_sec);
      const factor = span === 0 ? 0 : (time - Number(left.time_sec)) / span;
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

export const requestFaceTracking = async ({
  jobId,
  clipIndex,
  startSeconds,
  endSeconds,
  sourceWidth,
  sourceHeight,
}) => {
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Face tracking range and source dimensions are invalid.");
  const response = await fetch(
    getApiUrl(
      `/api/clip/${encodeURIComponent(jobId)}/${encodeURIComponent(clipIndex)}/face-tracking`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_seconds: start,
        end_seconds: end,
        source_width: width,
        source_height: height,
        algorithm_version: FACE_TRACKING_ALGORITHM_VERSION,
      }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.detail || "Face tracking analysis failed.");
  const normalized = normalizeFaceTrackingCache(payload, {
    durationMs: (end - start) * 1000,
    sourceStartSeconds: start,
    sourceEndSeconds: end,
    sourceWidth: width,
    sourceHeight: height,
  });
  if (!normalized) throw new Error("Face tracking returned an invalid cache.");
  return normalized;
};
