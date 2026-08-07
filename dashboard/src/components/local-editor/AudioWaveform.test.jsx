import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioData, getWaveformPortion } from '@remotion/media-utils';
import AudioWaveform from './AudioWaveform';

vi.mock('@remotion/media-utils', () => ({
    getAudioData: vi.fn(),
    getWaveformPortion: vi.fn(),
}));

describe('AudioWaveform', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads real audio data and renders peak bars', async () => {
        getAudioData.mockResolvedValue({ durationInSeconds: 4, channelWaveforms: [new Float32Array([0, 0.5, 1, 0.25])] });
        getWaveformPortion.mockReturnValue([
            { index: 0, amplitude: 0.25 },
            { index: 1, amplitude: 0.8 },
            { index: 2, amplitude: 0.45 },
        ]);

        render(<AudioWaveform videoUrl="blob:demo" durationMs={4000} sampleCount={3} />);

        await waitFor(() => expect(screen.getAllByTestId('audio-waveform-bar')).toHaveLength(3));
        expect(getAudioData).toHaveBeenCalledWith('blob:demo');
        expect(getWaveformPortion).toHaveBeenCalledWith(expect.objectContaining({
            audioData: expect.any(Object),
            startTimeInSeconds: 0,
            durationInSeconds: 4,
            numberOfSamples: 3,
        }));
        expect(screen.getByTestId('audio-waveform')).toHaveAttribute('aria-label', 'Audio waveform');
    });

    it('reuses decoded audio data while recalculating bars for a new sample count', async () => {
        getAudioData.mockResolvedValue({ durationInSeconds: 4, numberOfChannels: 1, sampleRate: 48000, channelWaveforms: [new Float32Array([0, 0.5, 1, 0.25])] });
        getWaveformPortion.mockImplementation(({ numberOfSamples }) => Array.from({ length: numberOfSamples }, (_, index) => ({ index, amplitude: 0.5 })));

        const { rerender } = render(<AudioWaveform videoUrl="blob:cache" durationMs={4000} sampleCount={3} />);
        await waitFor(() => expect(getWaveformPortion).toHaveBeenCalledTimes(1));

        rerender(<AudioWaveform videoUrl="blob:cache" durationMs={4000} sampleCount={4} />);

        await waitFor(() => expect(getWaveformPortion).toHaveBeenCalledTimes(2));
        expect(getAudioData).toHaveBeenCalledTimes(1);
        expect(getWaveformPortion).toHaveBeenLastCalledWith(expect.objectContaining({ numberOfSamples: 4 }));
    });

    it('keeps the lane usable when audio decoding fails', async () => {
        getAudioData.mockRejectedValue(new Error('unsupported audio'));

        render(<AudioWaveform videoUrl="blob:bad" durationMs={4000} sampleCount={3} />);

        await waitFor(() => expect(screen.getByText('Audio waveform unavailable')).toBeInTheDocument());
        expect(screen.getByTestId('audio-waveform')).toBeInTheDocument();
    });

    it('shows a no-source state without attempting a decode', () => {
        render(<AudioWaveform durationMs={4000} sampleCount={3} />);

        expect(screen.getByText('No audio source')).toBeInTheDocument();
        expect(getAudioData).not.toHaveBeenCalled();
    });
});
