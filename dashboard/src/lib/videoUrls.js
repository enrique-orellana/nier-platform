import { useCallback, useEffect, useState } from "react";
import { getApiUrl } from "../config";

export const MEDIA_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MEDIA_URL_RETRY_DELAY_MS = 30 * 1000;
const mediaUrlCache = new Map();
const mediaUrlRequests = new Map();

const scheduleMediaRenewal = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  timer?.unref?.();
  return timer;
};

export const getUrlFilename = (url) => {
  if (!url) return "";
  try {
    const parsed = new URL(url, window.location.origin);
    const pathname = decodeURIComponent(parsed.pathname || "");
    return pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return (
      url.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || ""
    );
  }
};

export const isGeneratedRenderUrl = (url) => {
  if (!url) return false;
  const filename = getUrlFilename(url).toLowerCase();
  if (filename.startsWith("source_clip_") || filename.startsWith("version_")) {
    return true;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(url, window.location.origin).pathname,
    ).toLowerCase();
    return /\/clips\/[^/]+\/(?:source_clip_|version_)/.test(pathname);
  } catch {
    return false;
  }
};

export const isSignedMediaUrl = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return Array.from(parsed.searchParams.keys()).some((key) =>
      key.toLowerCase().startsWith("x-amz-"),
    );
  } catch {
    return false;
  }
};

const parseAmzDate = (value) => {
  const match = String(value || "").match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (!match) return NaN;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
};

export const getMediaUrlExpiration = (url) => {
  if (!url) return NaN;
  try {
    const parsed = new URL(url, window.location.origin);
    const signedAt = parseAmzDate(parsed.searchParams.get("X-Amz-Date"));
    const expiresIn = Number(parsed.searchParams.get("X-Amz-Expires"));
    if (!Number.isFinite(signedAt) || !Number.isFinite(expiresIn)) return NaN;
    return signedAt + expiresIn * 1000;
  } catch {
    return NaN;
  }
};

const mediaUrlCacheKey = (url) => {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
};

const responseExpiration = (payload) => {
  const expiresAt = Number(payload?.expiresAt);
  if (Number.isFinite(expiresAt)) return expiresAt;
  const parsed = Date.parse(String(payload?.expiresAt || ""));
  return Number.isFinite(parsed) ? parsed : Date.now() + 60 * 60 * 1000;
};

export const refreshMediaUrl = async (url, { force = false, signal } = {}) => {
  if (!url || !isSignedMediaUrl(url)) {
    return { url, expiresAt: getMediaUrlExpiration(url) };
  }

  const key = mediaUrlCacheKey(url);
  const cached = mediaUrlCache.get(key);
  if (
    !force &&
    cached?.url &&
    cached.expiresAt > Date.now() + MEDIA_URL_REFRESH_BUFFER_MS
  ) {
    return cached;
  }
  if (!force && mediaUrlRequests.has(key)) {
    return mediaUrlRequests.get(key);
  }

  const controller = new AbortController();
  const request = fetch(
    `${getApiUrl("/api/media-url")}?url=${encodeURIComponent(url)}`,
    { signal: signal || controller.signal },
  )
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Media URL request failed (${response.status})`);
      const payload = await response.json();
      if (!payload?.url) throw new Error("Media URL response is missing url");
      const result = {
        url: payload.url,
        expiresAt: responseExpiration(payload),
      };
      mediaUrlCache.set(key, result);
      return result;
    })
    .finally(() => {
      mediaUrlRequests.delete(key);
    });

  mediaUrlRequests.set(key, request);
  return request;
};

export const useRenewableMediaUrl = (sourceUrl) => {
  const [state, setState] = useState({
    sourceUrl: "",
    url: "",
    expiresAt: NaN,
  });

  useEffect(() => {
    let active = true;
    let timer;
    const apply = (result) => {
      if (active) setState({ sourceUrl, ...result });
    };
    const schedule = (expiresAt, renew) => {
      const delay = Number.isFinite(expiresAt)
        ? Math.max(1000, expiresAt - Date.now() - MEDIA_URL_REFRESH_BUFFER_MS)
        : MEDIA_URL_RETRY_DELAY_MS;
      timer = scheduleMediaRenewal(() => void renew(true), delay);
    };
    const renew = async (force) => {
      try {
        const currentExpiration = getMediaUrlExpiration(sourceUrl);
        if (
          !force &&
          Number.isFinite(currentExpiration) &&
          currentExpiration > Date.now() + MEDIA_URL_REFRESH_BUFFER_MS
        ) {
          apply({ url: sourceUrl, expiresAt: currentExpiration });
          if (active) schedule(currentExpiration, renew);
          return;
        }
        const result = await refreshMediaUrl(sourceUrl, { force });
        apply(result);
        if (active && isSignedMediaUrl(sourceUrl))
          schedule(result.expiresAt, renew);
      } catch {
        if (active)
          timer = scheduleMediaRenewal(
            () => void renew(true),
            MEDIA_URL_RETRY_DELAY_MS,
          );
      }
    };

    setState({ sourceUrl, url: sourceUrl || "", expiresAt: NaN });
    if (isSignedMediaUrl(sourceUrl)) void renew(false);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sourceUrl]);

  const refresh = useCallback(async () => {
    const result = await refreshMediaUrl(sourceUrl, { force: true });
    setState({ sourceUrl, ...result });
    return result.url;
  }, [sourceUrl]);

  return { url: state.url || sourceUrl || "", refresh };
};

export const resolveClipVideoUrl = (clip) => {
  const explicitUrl = clip?.video_url || clip?.url;
  if (explicitUrl) return explicitUrl;
  return "";
};

export const resolveMasterVideoUrl = (clip) =>
  [
    clip?.source_video_url,
    clip?.original_video_url,
    clip?.source_url,
    clip?.video_url,
  ].find((url) => url && !isGeneratedRenderUrl(url)) || "";

export const resolvePreviewStartSeconds = (clip) =>
  clip?.source_preview
    ? Number(clip?.start || 0)
    : clip?.video_url
      ? 0
      : Number(clip?.start || 0);
