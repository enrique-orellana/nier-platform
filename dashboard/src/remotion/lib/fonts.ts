import { staticFile } from "remotion";

/**
 * CSS @font-face declaration for NotoSerif-Bold (bundled locally).
 * Use in components via: <style>{notoSerifFontFace}</style>
 */
export const NOTO_SERIF_FONT_FAMILY = "NotoSerif-Bold";
export const COLOR_EMOJI_FONT_FAMILY = "Noto Color Emoji";

/**
 * Keep emoji fallback explicit so the browser preview matches server renders.
 */
export function getHookFontStack(): string {
  return `'${NOTO_SERIF_FONT_FAMILY}', 'Noto Serif', '${COLOR_EMOJI_FONT_FAMILY}', Georgia, serif`;
}

export const notoSerifFontFace = `
@font-face {
  font-family: '${NOTO_SERIF_FONT_FAMILY}';
  src: url('${staticFile("fonts/NotoSerif-Bold.ttf")}') format('truetype');
  font-weight: 700;
  font-style: normal;
}
`;

/**
 * Map of subtitle font families to their CSS-safe names.
 * These match the options available in SubtitleModal.jsx.
 */
export const SUBTITLE_FONTS: Record<string, string> = {
  Verdana: "Verdana, Geneva, sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  Impact: "Impact, Haettenschweiler, sans-serif",
  Helvetica: "Helvetica, Arial, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  "Courier New": "'Courier New', Courier, monospace",
};

export function getFontStack(fontFamily: string): string {
  const stack = SUBTITLE_FONTS[fontFamily] ?? fontFamily;
  return stack.replace(
    /,\s*(sans-serif|serif)\s*$/,
    `, '${COLOR_EMOJI_FONT_FAMILY}', $1`,
  );
}
