export const HOOK_SIZE_OPTIONS = [
    { value: 'S', label: 'Small' },
    { value: 'M', label: 'Medium' },
    { value: 'L', label: 'Large' },
];

export const HOOK_ENTRANCE_OPTIONS = [
    { value: 'spring', label: 'Bounce' },
    { value: 'fade', label: 'Fade' },
    { value: 'slide-up', label: 'Slide Up' },
    { value: 'none', label: 'None' },
];

export const HOOK_SIZE_SCALE = { S: 0.8, M: 1, L: 1.3 };

export const SUBTITLE_FONT_OPTIONS = ['Verdana', 'Arial', 'Impact', 'Helvetica', 'Georgia', 'Courier New'];
export const SUBTITLE_COLOR_PRESETS = [
    { color: '#FFFFFF', label: 'White' },
    { color: '#FFFF00', label: 'Yellow' },
    { color: '#00FFFF', label: 'Cyan' },
    { color: '#00FF00', label: 'Green' },
    { color: '#FF0000', label: 'Red' },
    { color: '#FF69B4', label: 'Pink' },
];
export const SUBTITLE_HIGHLIGHT_PRESETS = [
    { color: '#FFDD00', label: 'Gold' },
    { color: '#FF4444', label: 'Red' },
    { color: '#00FF88', label: 'Green' },
    { color: '#00BBFF', label: 'Blue' },
    { color: '#FF69B4', label: 'Pink' },
];
export const SUBTITLE_ANIMATION_OPTIONS = [
    { value: 'pop', label: 'Pop' },
    { value: 'word-highlight', label: 'Glow' },
    { value: 'karaoke', label: 'Karaoke' },
    { value: 'none', label: 'None' },
];

export const DEFAULT_SUBTITLE_STYLE = {
    position: 'bottom',
    fontFamily: 'Verdana',
    fontSize: 24,
    fontColor: '#FFFFFF',
    highlightColor: '#FFDD00',
    borderColor: '#000000',
    borderWidth: 2,
    bgColor: '#000000',
    bgOpacity: 0,
    animation: 'pop',
};

export const normalizeSubtitleStyle = (style = {}) => ({ ...DEFAULT_SUBTITLE_STYLE, ...style });

// SubtitleModal uses compact controls and scales them for the 608x1080
// Remotion composition. Keep the local editor on that same render contract.
export const toClipGeneratorSubtitleStyle = (style = {}) => {
    const normalized = normalizeSubtitleStyle(style);
    return {
        ...normalized,
        fontSize: Number((Number(normalized.fontSize) * 2.2).toFixed(1)),
        borderWidth: Number(normalized.borderWidth) * 1.5,
    };
};

export const subtitlePositionClass = (position) => (
    position === 'top' ? 'top-[12%]' : position === 'middle' ? 'top-[45%]' : 'bottom-[10%]'
);

export const hookPositionClass = (position) => (
    position === 'top' ? 'top-[8%]' : position === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-[18%]'
);

export const hexToRgba = (hex, opacity) => {
    const value = String(hex || '#000000').replace('#', '');
    const normalized = value.length === 3 ? value.split('').map((part) => `${part}${part}`).join('') : value;
    const red = parseInt(normalized.slice(0, 2), 16) || 0;
    const green = parseInt(normalized.slice(2, 4), 16) || 0;
    const blue = parseInt(normalized.slice(4, 6), 16) || 0;
    return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, Number(opacity) || 0))})`;
};
