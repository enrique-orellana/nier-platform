import { getApiUrl } from "../../config";
import { renderInBrowser } from "../../lib/renderInBrowser";
import { toClipGeneratorSubtitleStyle } from "./localEditorStyles";

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const cueWords = (text) =>
  String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const terminalPeriods = /\.+(?=["'’”»)\]]*\s*$)/;

const cleanSubtitleText = (text) =>
  String(text || "").replace(terminalPeriods, "");

export const cleanSubtitleCue = (cue) => ({
  ...cue,
  text: cleanSubtitleText(cue?.text),
  ...(Array.isArray(cue?.captions)
    ? {
        captions: cue.captions.map((caption) => ({
          ...caption,
          text: cleanSubtitleText(caption?.text),
        })),
      }
    : {}),
});

const cueText = (cue) => String(cue?.text || "").trim();
const captionText = (captions) =>
  captions
    .map((caption) => String(caption?.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
const sameCaptions = (left = [], right = []) =>
  left.length === right.length &&
  left.every((caption, index) => {
    const other = right[index];
    return (
      String(caption?.text || "") === String(other?.text || "") &&
      Number(caption?.startMs) === Number(other?.startMs) &&
      Number(caption?.endMs) === Number(other?.endMs)
    );
  });

const distributeCueWords = (text, startMs, endMs) => {
  const words = cueWords(text);
  if (!words.length) return [];
  const start = Number(startMs) || 0;
  const end = Math.max(start + 1, Number(endMs) || start + 1);
  const duration = end - start;
  return words.map((word, index) => ({
    text: word,
    startMs: Math.round(start + (index * duration) / words.length),
    endMs: Math.max(
      Math.round(start + (index * duration) / words.length) + 1,
      Math.round(start + ((index + 1) * duration) / words.length),
    ),
  }));
};

export const syncSubtitleCue = (previousCue, nextCue) => {
  const nextText = cueText(nextCue);
  if (!Array.isArray(previousCue?.captions) || !previousCue.captions.length) {
    return nextText
      ? {
          ...nextCue,
          captions: distributeCueWords(
            nextText,
            nextCue.startMs,
            nextCue.endMs,
          ),
        }
      : nextCue;
  }
  const previousText = captionText(previousCue.captions);
  if (
    Array.isArray(nextCue.captions) &&
    nextCue.captions.length &&
    !sameCaptions(previousCue.captions, nextCue.captions)
  ) {
    return captionText(nextCue.captions) === nextText
      ? nextCue
      : {
          ...nextCue,
          captions: distributeCueWords(
            nextText,
            nextCue.startMs,
            nextCue.endMs,
          ),
        };
  }
  if (previousText !== nextText) {
    return {
      ...nextCue,
      captions: distributeCueWords(nextText, nextCue.startMs, nextCue.endMs),
    };
  }

  const previousStart = Number(previousCue.startMs) || 0;
  const previousDuration = Math.max(
    1,
    (Number(previousCue.endMs) || previousStart + 1) - previousStart,
  );
  const nextStart = Number(nextCue.startMs) || 0;
  const nextDuration = Math.max(
    1,
    (Number(nextCue.endMs) || nextStart + 1) - nextStart,
  );
  return {
    ...nextCue,
    captions: previousCue.captions.map((caption) => ({
      ...caption,
      startMs: Math.round(
        nextStart +
          (((Number(caption.startMs) || previousStart) - previousStart) /
            previousDuration) *
            nextDuration,
      ),
      endMs: Math.max(
        Math.round(
          nextStart +
            (((Number(caption.startMs) || previousStart) - previousStart) /
              previousDuration) *
              nextDuration,
        ) + 1,
        Math.round(
          nextStart +
            (((Number(caption.endMs) || previousStart + 1) - previousStart) /
              previousDuration) *
              nextDuration,
        ),
      ),
    })),
  };
};

export const cueCaptionsForRender = (cue) => {
  if (!Array.isArray(cue?.captions) || !cue.captions.length) {
    return [
      {
        text: cueText(cue),
        startMs: Number(cue?.startMs),
        endMs: Number(cue?.endMs),
      },
    ];
  }
  return captionText(cue.captions) === cueText(cue)
    ? cue.captions.map((caption) => ({
        text: String(caption.text || ""),
        startMs: Number(caption.startMs),
        endMs: Number(caption.endMs),
      }))
    : distributeCueWords(cueText(cue), cue.startMs, cue.endMs);
};

export const buildRemotionRenderProps = ({
  durationSeconds,
  fps = 30,
  width,
  height,
  videoFit = "cover",
  subtitleCues = [],
  subtitleStyle = null,
  hook = null,
}) => ({
  durationInFrames: Math.max(
    1,
    Math.round(Number(durationSeconds || 0) * Number(fps || 30)),
  ),
  fps: Number(fps || 30),
  width: Number(width),
  height: Number(height),
  videoFit,
  subtitles: subtitleCues.length
    ? {
        captions: subtitleCues.flatMap((cue) => cueCaptionsForRender(cue)),
        blocks: subtitleCues.map((cue) => ({
          words: cueCaptionsForRender(cue),
          startMs: Number(cue.startMs),
          endMs: Number(cue.endMs),
          text: String(cue.text || ""),
        })),
        position: subtitleStyle?.position || "bottom",
        style: toClipGeneratorSubtitleStyle(subtitleStyle || undefined),
      }
    : null,
  hook: hook
    ? {
        ...hook,
        text: String(hook.text || ""),
        position: hook.position || "top",
        size: hook.size || "M",
        entranceAnimation: hook.entranceAnimation || "none",
        displayDurationSec: Math.max(
          0.001,
          (Number(hook.endMs) - Number(hook.startMs)) / 1000,
        ),
        startMs: Number(hook.startMs) || 0,
        endMs: Number(hook.endMs),
      }
    : null,
  effects: null,
});

export async function renderLocalVideoOnBrowser({
  videoUrl,
  durationSeconds,
  fps = 30,
  width,
  height,
  videoFit = "cover",
  subtitleCues = [],
  subtitleStyle = null,
  hook = null,
  onProgress = () => {},
  signal,
}) {
  const props = buildRemotionRenderProps({
    durationSeconds,
    fps,
    width,
    height,
    videoFit,
    subtitleCues,
    subtitleStyle,
    hook,
  });
  return renderInBrowser({
    videoUrl,
    durationInSeconds: durationSeconds,
    fps,
    width,
    height,
    subtitles: props.subtitles,
    hook: props.hook,
    effects: props.effects,
    onProgress,
    signal,
  });
}

const responsePayload = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload.detail || payload.error || `Request failed (${response.status})`,
    );
  return payload;
};

export async function renderLocalVideoOnBackend({
  file,
  sourceUrl = "",
  jobId = "",
  clipIndex = 0,
  durationSeconds,
  fps = 30,
  width,
  height,
  videoFit = "cover",
  subtitleCues = [],
  subtitleStyle = null,
  hook = null,
  onProgress = () => {},
  pollMs = 1200,
  fetchImpl = fetch,
  returnMetadata = false,
}) {
  if (!file && !sourceUrl) throw new Error("A local video is required.");
  const props = buildRemotionRenderProps({
    durationSeconds,
    fps,
    width,
    height,
    videoFit,
    subtitleCues,
    subtitleStyle,
    hook,
  });
  let requestUrl = getApiUrl("/api/local-editor/render");
  let requestOptions;
  if (file) {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("props", JSON.stringify(props));
    requestOptions = { method: "POST", body: formData };
  } else {
    if (!jobId) throw new Error("A project video requires a project ID.");
    requestUrl = getApiUrl("/api/render");
    requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        clipIndex,
        props: { ...props, videoUrl: sourceUrl },
      }),
    };
  }

  const started = await responsePayload(
    await fetchImpl(requestUrl, requestOptions),
  );
  if (!started.renderId || (!started.jobId && !jobId))
    throw new Error("Render service did not return a render ID.");
  const renderJobId = started.jobId || jobId;

  let status = null;
  do {
    if (pollMs > 0) await wait(pollMs);
    status = await responsePayload(
      await fetchImpl(getApiUrl(`/api/render/${started.renderId}`)),
    );
    onProgress(Math.max(0, Math.min(1, Number(status.progress || 0) / 100)));
    if (status.status === "error" || status.status === "failed")
      throw new Error(status.error || "Native video render failed.");
    if (status.status === "done" || status.status === "completed") {
      const publishedOutputUrl = String(status.outputUrl || "");
      const filename = publishedOutputUrl
        .split(/[\\/]/)
        .filter(Boolean)
        .pop()
        ?.split("?")[0];
      if (!filename)
        throw new Error("Render completed without an output file.");
      onProgress(1);
      const result = {
        outputUrl: /^https?:\/\//i.test(publishedOutputUrl)
          ? publishedOutputUrl
          : getApiUrl(publishedOutputUrl),
        jobId: renderJobId,
        filename,
      };
      return returnMetadata ? result : result.outputUrl;
    }
  } while (status.status !== "done" && status.status !== "completed");
}

export async function burnLocalEditorSubtitles({
  file,
  sourceUrl = "",
  jobId = "",
  clipIndex = 0,
  durationSeconds,
  fps = 30,
  width,
  height,
  videoFit = "cover",
  subtitleCues = [],
  subtitleStyle = null,
  hook = null,
  onProgress = () => {},
  pollMs = 1200,
  fetchImpl = fetch,
}) {
  return renderLocalVideoOnBackend({
    file,
    sourceUrl,
    jobId,
    clipIndex,
    durationSeconds,
    fps,
    width,
    height,
    videoFit,
    subtitleCues,
    subtitleStyle,
    hook,
    onProgress,
    pollMs,
    fetchImpl,
  });
}
