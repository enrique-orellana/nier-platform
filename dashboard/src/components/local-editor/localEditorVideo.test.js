import { describe, expect, it } from 'vitest';
import { hasEmbeddedSideBars } from './localEditorVideo';

const makeImageData = (width, height, contentStart, contentEnd) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
    for (let y = 0; y < height; y += 1) {
        for (let x = contentStart; x <= contentEnd; x += 1) {
            const index = (y * width + x) * 4;
            data[index] = 220;
            data[index + 1] = 220;
            data[index + 2] = 220;
            data[index + 3] = 255;
        }
    }
    return { data, width, height };
};

describe('localEditorVideo', () => {
    it('detects portrait content embedded inside black sidebars', () => {
        expect(hasEmbeddedSideBars(makeImageData(10, 6, 3, 6))).toBe(true);
    });

    it('does not crop a frame that has content across its width', () => {
        expect(hasEmbeddedSideBars(makeImageData(10, 6, 0, 9))).toBe(false);
    });
});
