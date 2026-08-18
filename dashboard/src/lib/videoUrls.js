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

export const toProxiedVideoUrl = (url) => {
  return url;
};

export const resolveClipVideoUrl = (clip) => {
  const explicitUrl = clip?.video_url || clip?.url;
  if (explicitUrl) return explicitUrl;
  return "";
};

export const resolveMasterVideoUrl = (clip) =>
  clip?.source_video_url || clip?.original_video_url || clip?.video_url || "";
