import { staticFile } from "remotion";

/**
 * CSS @font-face declaration for NotoSerif-Bold (bundled locally).
 * Use in components via: <style>{notoSerifFontFace}</style>
 */
export const NOTO_SERIF_FONT_FAMILY = "NotoSerif-Bold";
export const COLOR_EMOJI_FONT_FAMILY = "Noto Color Emoji";
export const COLOR_EMOJI_FONT_STACK = `'Apple Color Emoji', 'Segoe UI Emoji', '${COLOR_EMOJI_FONT_FAMILY}'`;

/**
 * Keep emoji fallback explicit so the browser preview matches server renders.
 */
export function getHookFontStack(): string {
  return `'${NOTO_SERIF_FONT_FAMILY}', 'Noto Serif', ${COLOR_EMOJI_FONT_STACK}, Georgia, serif`;
}

export const notoSerifFontFace = `
@font-face {
  font-family: '${NOTO_SERIF_FONT_FAMILY}';
  src: url('${staticFile("fonts/NotoSerif-Bold.ttf")}') format('truetype');
  font-weight: 700;
  font-style: normal;
}
`;

export const subtitleFontFace = `
@font-face {
  font-family: 'OpenShortsSans';
  src: url('/fonts/OpenShortsSans.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'OpenShortsSans';
  src: url('/fonts/OpenShortsSans-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}
@font-face {
  font-family: 'OpenShortsImpact';
  src: url('/fonts/OpenShortsImpact.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}
@font-face {
  font-family: 'OpenShortsSerif';
  src: url('/fonts/OpenShortsSerif.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'OpenShortsSerif';
  src: url('/fonts/OpenShortsSerif-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}
@font-face {
  font-family: 'OpenShortsMono';
  src: url('/fonts/OpenShortsMono.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'OpenShortsMono';
  src: url('/fonts/OpenShortsMono-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}
`;

/**
 * Map of subtitle font families to their CSS-safe names.
 * These match the options available in SubtitleModal.jsx.
 */
export const SUBTITLE_FONTS: Record<string, string> = {
  Verdana: "OpenShortsSans, sans-serif",
  Arial: "OpenShortsSans, sans-serif",
  Impact: "OpenShortsImpact, sans-serif",
  Helvetica: "OpenShortsSans, sans-serif",
  Georgia: "OpenShortsSerif, serif",
  "Courier New": "OpenShortsMono, monospace",
};

export function getFontStack(fontFamily: string): string {
  const stack = SUBTITLE_FONTS[fontFamily] ?? fontFamily;
  return stack.replace(
    /,\s*(sans-serif|serif)\s*$/,
    `, ${COLOR_EMOJI_FONT_STACK}, $1`,
  );
}
