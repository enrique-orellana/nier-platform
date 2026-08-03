import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LocalEditorTab from './LocalEditorTab';

const makeVideoFile = () => new File(['video'], 'demo.mp4', { type: 'video/mp4' });

if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:demo' });
}

describe('LocalEditorTab', () => {
    it('shows a local-only upload state', () => {
        render(<LocalEditorTab />);
        expect(screen.getByRole('heading', { name: 'Local Editor' })).toBeInTheDocument();
        expect(screen.getByText(/stays in your browser/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/upload video/i)).toBeInTheDocument();
    });

    it('shows timeline controls after selecting a video', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /import subtitles/i })).toBeInTheDocument());
        expect(screen.getAllByText('Viral Hook').length).toBeGreaterThan(0);
    });

    it('imports an SRT file', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });
        fireEvent.click(screen.getByRole('button', { name: /import subtitles/i }));
        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
    });

    it('adds and edits a hook, then resets', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        fireEvent.click(screen.getByRole('button', { name: /add viral hook/i }));
        fireEvent.change(screen.getByLabelText('Hook text', { exact: true }), { target: { value: 'Watch this' } });
        expect(screen.getByLabelText('Hook text', { exact: true })).toHaveValue('Watch this');
        expect(screen.getByRole('button', { name: 'Small' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bounce' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /remove hook/i }));
        expect(screen.getByText(/add a hook/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await waitFor(() => expect(screen.queryByText('Viral Hook')).not.toBeInTheDocument());
    });

    it('exposes subtitle styling and removes the whole subtitle track', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });
        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByRole('button', { name: 'Hello' })[0]);
        expect(screen.getByLabelText('Subtitle font')).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle position')).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle font size')).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle text color')).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle highlight color')).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle outline width')).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle background opacity')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pop' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /remove subtitles/i }));
        expect(screen.queryByText('Hello')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export subtitles/i })).toBeDisabled();
    });
});
