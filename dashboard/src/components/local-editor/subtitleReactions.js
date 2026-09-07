export const DEFAULT_SUBTITLE_REACTION_STYLE = {
  position: "above",
  animation: "pop",
  scale: 1,
};

const REACTION_POSITIONS = ["above", "left", "right"];
const REACTION_ANIMATIONS = ["pop", "shake", "fade"];

export const normalizeSubtitleReactionStyle = (value = {}) => {
  const style = value || {};
  return {
    position: REACTION_POSITIONS.includes(style.position)
      ? style.position
      : DEFAULT_SUBTITLE_REACTION_STYLE.position,
    animation: REACTION_ANIMATIONS.includes(style.animation)
      ? style.animation
      : DEFAULT_SUBTITLE_REACTION_STYLE.animation,
    scale: Math.min(2, Math.max(1, Number(style.scale) || 1)),
  };
};

export const normalizeSubtitleReactions = (items = [], cues = null) =>
  (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const reaction = item || {};
    const requestedCueIndex = Number(reaction.cueIndex);
    const requestedCueId = reaction.cueId ? String(reaction.cueId) : "";
    const cueList = Array.isArray(cues) ? cues : null;
    const cue = cueList
      ? requestedCueId
        ? cueList.find(
            (candidate) => String(candidate?.id || "") === requestedCueId,
          )
        : cueList[requestedCueIndex]
      : null;
    if (cueList && !cue) return [];
    const cueIndex = cue ? cueList.indexOf(cue) : requestedCueIndex;
    const startMs = cue ? Number(cue.startMs) : Number(reaction.startMs);
    const endMs = cue ? Number(cue.endMs) : Number(reaction.endMs);
    const emojis = (Array.isArray(reaction.emojis) ? reaction.emojis : [])
      .map((emoji) => String(emoji).trim())
      .filter(Boolean)
      .slice(0, 2);

    if (
      !Number.isInteger(cueIndex) ||
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      !emojis.length
    ) {
      return [];
    }

    return [
      {
        id: reaction.id || `reaction-${cueIndex}-${index}`,
        ...(cue?.id || requestedCueId
          ? { cueId: String(cue?.id || requestedCueId) }
          : {}),
        cueIndex,
        startMs,
        endMs,
        emojis,
        enabled: reaction.enabled !== false,
      },
    ];
  });

export const makePendingReactionReview = (reactions = [], cues = []) =>
  normalizeSubtitleReactions(reactions, cues).flatMap((reaction) => {
    const cue = cues[reaction.cueIndex];
    return cue ? [{ ...reaction, text: cue.text || cue.label || "" }] : [];
  });

export const reactionRequestCues = (cues = []) =>
  (Array.isArray(cues) ? cues : []).flatMap((cue, index) => {
    const sourceCue = cue || {};
    const text = String(sourceCue.text || sourceCue.label || "").trim();
    const startMs = Number(sourceCue.startMs);
    const endMs = Number(sourceCue.endMs);

    return text &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs > startMs
      ? [{ index, text, startMs, endMs }]
      : [];
  });
