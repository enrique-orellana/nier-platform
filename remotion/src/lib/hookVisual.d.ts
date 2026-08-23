import type { CSSProperties } from "react";
export declare const HOOK_PREVIEW_WIDTH = 360;
export declare const HOOK_OUTPUT_WIDTH = 1080;
export declare const HOOK_OUTPUT_HEIGHT = 1920;
export declare const HOOK_FONT_FAMILY = "Arial, Helvetica, sans-serif";
export declare const HOOK_SIZE_SCALE: Record<string, number>;
export declare const FACECAM_HEIGHT_RATIOS: Record<string, number>;
export declare const getHookFontSize: (fontSize?: number, size?: string, renderWidth?: number) => number;
export declare const getStreamerBoundaryRatio: (facecamSize?: string) => number;
export declare const clampHookCoordinate: (value: number, maximum: number, fallback: number) => number;
export declare const getHookPositionCoordinates: (hook?: {
    position?: string;
    positionX?: number;
    positionY?: number;
    layoutFormat?: string;
    facecamSize?: string;
}, renderWidth?: number, renderHeight?: number) => {
    x: number;
    y: number;
};
export declare const getHookPositionStyle: (positionOrHook?: string | {
    position?: string;
    positionX?: number;
    positionY?: number;
    layoutFormat?: string;
    facecamSize?: string;
}, layoutFormat?: string, facecamSize?: string, renderWidth?: number, renderHeight?: number) => CSSProperties;
export declare const getHookAnimationStyle: (entranceAnimation?: string, elapsedMs?: number, renderWidth?: number) => CSSProperties;
export declare const getHookBoxStyle: (hook?: {
    color?: string;
    background?: string;
    fontFamily?: string;
    fontSize?: number;
    size?: string;
    layoutFormat?: string;
}, renderWidth?: number) => CSSProperties;
