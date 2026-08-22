import { groupCaptionsIntoBlocks } from "../../remotion/lib/captions";

export const DEFAULT_DURATION_MS = 30000;

export const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

export const clampCue = (cue, durationMs) => {
  const duration = Math.max(1, durationMs || DEFAULT_DURATION_MS);
  const startMs = clamp(cue.startMs, 0, Math.max(0, duration - 80));
  const endMs = clamp(cue.endMs, startMs + 80, duration);
  return { ...cue, startMs, endMs };
};

export const normalizeGeneratedCues = (captions, durationMs) => {
  const wordCaptions = (Array.isArray(captions) ? captions : [])
    .map((caption) => ({
      text: String(caption?.text || caption?.word || "").trim(),
      startMs: Number(caption?.startMs ?? Number(caption?.start || 0) * 1000),
      endMs: Number(caption?.endMs ?? Number(caption?.end || 0) * 1000),
    }))
    .filter(
      (caption) =>
        caption.text &&
        Number.isFinite(caption.startMs) &&
        Number.isFinite(caption.endMs) &&
        caption.endMs > caption.startMs,
    )
    .sort((left, right) => left.startMs - right.startMs);
  const blocks = wordCaptions.length
    ? groupCaptionsIntoBlocks(wordCaptions).map((block) => ({
        text: block.text,
        startMs: block.startMs,
        endMs: block.endMs,
        captions: block.words.map((word) => ({
          text: word.text,
          startMs: word.startMs,
          endMs: word.endMs,
        })),
      }))
    : [];
  let previousEndMs = 0;
  return blocks
    .map((segment, index) => ({
      id: `generated-${Date.now()}-${index}`,
      type: "subtitle",
      label: segment.text,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      captions: segment.captions,
    }))
    .filter(
      (cue) =>
        cue.text &&
        Number.isFinite(cue.startMs) &&
        Number.isFinite(cue.endMs) &&
        cue.endMs > cue.startMs,
    )
    .sort((left, right) => left.startMs - right.startMs)
    .map((cue) => {
      const normalized = clampCue(
        { ...cue, startMs: Math.max(cue.startMs, previousEndMs) },
        durationMs,
      );
      if (normalized.endMs <= normalized.startMs) return null;
      previousEndMs = normalized.endMs;
      return normalized;
    })
    .filter(Boolean);
};

export const outlineTextShadow = (width, color) => {
  const borderWidth = Math.max(0, Number(width) || 0);
  if (!borderWidth) return "none";
  return [
    `${borderWidth}px 0 0 ${color}`,
    `-${borderWidth}px 0 0 ${color}`,
    `0 ${borderWidth}px 0 ${color}`,
    `0 -${borderWidth}px 0 ${color}`,
  ].join(", ");
};

export const cleanChoiceClass = (selected) =>
  `rounded-lg border p-2 text-center text-xs font-medium transition-all ${selected ? "border-primary bg-primary/20 text-white" : "border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"}`;

export const hookChoiceClass = (selected) =>
  `rounded-lg border px-1 py-2 text-center text-xs font-bold capitalize transition-all ${selected ? "border-white bg-white text-black" : "border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"}`;

export const cleanLabelClass =
  "mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-400";

export const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadUrl = (url, fileName) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
};
