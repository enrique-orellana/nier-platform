const DARK_PIXEL_THRESHOLD = 24;
const DARK_COLUMN_RATIO = 0.96;
const MIN_SIDE_BAR_RATIO = 0.12;

const evenDimension = (value) => {
    const rounded = Math.max(2, Math.round(Number(value) || 0));
    return rounded % 2 === 0 ? rounded : rounded - 1;
};

export const getFilledFrameDimensions = (width, height, targetAspect = 9 / 16) => {
    const sourceWidth = Math.max(2, Number(width) || 2);
    const sourceHeight = Math.max(2, Number(height) || 2);
    const sourceAspect = sourceWidth / sourceHeight;
    if (sourceAspect > targetAspect) {
        return { width: evenDimension(sourceHeight * targetAspect), height: evenDimension(sourceHeight) };
    }
    return { width: evenDimension(sourceWidth), height: evenDimension(sourceWidth / targetAspect) };
};

const isDarkPixel = (data, index) => (
    data[index] <= DARK_PIXEL_THRESHOLD
    && data[index + 1] <= DARK_PIXEL_THRESHOLD
    && data[index + 2] <= DARK_PIXEL_THRESHOLD
    && data[index + 3] > 0
);

const isDarkColumn = (imageData, column) => {
    const { data, width, height } = imageData;
    let darkPixels = 0;
    for (let row = 0; row < height; row += 1) {
        if (isDarkPixel(data, (row * width + column) * 4)) darkPixels += 1;
    }
    return darkPixels / Math.max(1, height) >= DARK_COLUMN_RATIO;
};

export function hasEmbeddedSideBars(imageData) {
    if (!imageData?.width || !imageData?.height || !imageData?.data) return false;
    const { width } = imageData;
    let left = 0;
    let right = width - 1;
    while (left < width / 2 && isDarkColumn(imageData, left)) left += 1;
    while (right >= width / 2 && isDarkColumn(imageData, right)) right -= 1;
    return (left + (width - 1 - right)) / width >= MIN_SIDE_BAR_RATIO;
}

export function detectEmbeddedSideBars(video) {
    if (!video?.videoWidth || !video?.videoHeight || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const width = Math.min(320, video.videoWidth);
    const height = Math.max(1, Math.round(width * (video.videoHeight / video.videoWidth)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(video, 0, 0, width, height);
    return hasEmbeddedSideBars(context.getImageData(0, 0, width, height));
}
