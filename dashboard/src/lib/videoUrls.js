import { getApiUrl } from '../config';

export const getUrlFilename = (url) => {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    const pathname = decodeURIComponent(parsed.pathname || '');
    return pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
  }
};

export const toProxiedVideoUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('blob:') || !url.startsWith('http')) return url;
  const encoded = encodeURIComponent(url);
  const proxyFilename = getUrlFilename(url) || 'video.mp4';
  return getApiUrl(`/api/video-proxy/${encodeURIComponent(proxyFilename)}?url=${encoded}`);
};

export const resolveClipVideoUrl = (clip, jobId) => {
  const explicitUrl = clip?.video_url || clip?.url;
  if (explicitUrl) return explicitUrl;

  const filename = String(clip?.video_filename || '').trim();
  const projectId = String(jobId || '').trim();
  return filename && projectId ? `/videos/${projectId}/${filename}` : '';
};
