import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocalEditorTab from './LocalEditorTab';
import { DEFAULT_SUBTITLE_STYLE } from './localEditorStyles';

const makeVideoFile = () => new File(['video'], 'demo.mp4', { type: 'video/mp4' });

if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:demo' });
}

describe('LocalEditorTab', () => {
    beforeEach(() => {
        localStorage.clear();
    });

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
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        expect(screen.getByRole('button', { name: /import subtitles/i })).toBeInTheDocument();
        expect(screen.getAllByText('Viral Hook').length).toBeGreaterThan(0);
    });

    it('offers a viewport-sized player and fullscreen control', async () => {
        const requestFullscreen = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, writable: true, value: requestFullscreen });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /enter fullscreen/i })).toBeInTheDocument());
        expect(screen.getByTestId('local-editor-player')).toHaveClass('max-h-[72vh]');
        fireEvent.click(screen.getByRole('button', { name: /enter fullscreen/i }));
        expect(requestFullscreen).toHaveBeenCalledTimes(1);
    });

    it('allows the player to fill the preview when fit mode leaves bars visible', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /fill video/i })).toBeInTheDocument());
        const video = screen.getByTestId('local-editor-player').querySelector('video');
        expect(video).toHaveClass('object-contain');
        fireEvent.click(screen.getByRole('button', { name: /fill video/i }));
        expect(video).toHaveClass('object-cover');
    });

    it('collapses overlay settings and exposes custom video controls', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /play video/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /stop video/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /rewind 5 seconds/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /fast forward 5 seconds/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('button', { name: /toggle viral hook settings/i })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('button', { name: /import subtitles/i })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: /import subtitles/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /toggle viral hook settings/i }));
        expect(screen.getByRole('button', { name: /toggle viral hook settings/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('supports standard video keyboard controls', async () => {
        const requestFullscreen = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, writable: true, value: requestFullscreen });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByTestId('local-editor-player')).toBeInTheDocument());
        const player = screen.getByTestId('local-editor-player');
        const video = player.querySelector('video');
        fireEvent.keyDown(player, { key: 'ArrowRight' });
        expect(video.currentTime).toBe(5);
        fireEvent.keyDown(player, { key: 'Home' });
        expect(video.currentTime).toBe(0);
        fireEvent.keyDown(player, { key: 'm' });
        expect(video.muted).toBe(true);
        fireEvent.keyDown(player, { key: 'f' });
        expect(requestFullscreen).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(player, { key: ' ' });
        await waitFor(() => expect(video.play).toHaveBeenCalled());
    });

    it('imports an SRT file', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });
        fireEvent.click(screen.getByRole('button', { name: /import subtitles/i }));
        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
    });

    it('undoes an imported subtitle track as one action', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });

        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
        expect(screen.getByRole('button', { name: 'Undo', exact: true })).not.toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    });

    it('undoes the latest imported cue edit without removing the imported track', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });

        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByRole('button', { name: 'Hello' })[0]);
        fireEvent.change(screen.getByLabelText('Subtitle text'), { target: { value: 'Changed' } });
        fireEvent.keyDown(screen.getByTestId('local-editor-player'), { key: 'z', ctrlKey: true });

        expect(screen.getByLabelText('Subtitle text')).toHaveValue('Hello');
        expect(screen.getAllByText('Hello').length).toBeGreaterThan(0);
    });

    it('uses editor history for Ctrl+Z while editing a cue', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });

        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByRole('button', { name: 'Hello' })[0]);
        fireEvent.change(screen.getByLabelText('Subtitle text'), { target: { value: 'Changed' } });
        fireEvent.keyDown(screen.getByLabelText('Subtitle text'), { key: 'z', ctrlKey: true });

        expect(screen.getByLabelText('Subtitle text')).toHaveValue('Hello');
    });

    it('keeps the last ten editor actions undoable', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /add subtitle cue/i })).toBeInTheDocument());

        for (let index = 0; index < 12; index += 1) fireEvent.click(screen.getByRole('button', { name: /add subtitle cue/i }));
        for (let index = 0; index < 11; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));

        expect(screen.getAllByRole('button', { name: 'Timeline cue' })).toHaveLength(2);
    });

    it('persists editor actions in local browser storage', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /add subtitle cue/i })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /add subtitle cue/i }));

        const saved = JSON.parse(localStorage.getItem('openshorts_local_editor_state_v1'));
        expect(saved.present.subtitleCues).toHaveLength(1);
        expect(saved.past).toHaveLength(1);
    });

    it('restores saved editor actions after the component is mounted again', async () => {
        const restoredCue = { id: 'restored', type: 'subtitle', label: 'Restored', text: 'Restored', startMs: 0, endMs: 1000 };
        localStorage.setItem('openshorts_local_editor_state_v1', JSON.stringify({
            past: [],
            present: { subtitleCues: [restoredCue], subtitleStyle: DEFAULT_SUBTITLE_STYLE, hook: null },
            future: [],
        }));
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });

        await waitFor(() => expect(screen.getAllByText('Restored').length).toBeGreaterThan(0));
    });

    it('persists the final position of an imported cue after a timeline move', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 1000, height: 100, top: 0, left: 0, right: 1000, bottom: 100 }));
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
        const subtitleFile = new File(['subtitle'], 'captions.srt', { type: 'application/x-subrip' });
        subtitleFile.text = async () => '1\n00:00:00,000 --> 00:00:01,000\nHello';
        fireEvent.change(screen.getByLabelText(/subtitle file/i), { target: { files: [subtitleFile] } });
        await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0));

        const cue = screen.getByRole('button', { name: 'Hello' });
        act(() => cue.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0 })));
        act(() => {
            window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, bubbles: true }));
            window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, bubbles: true }));
        });

        await waitFor(() => {
            const saved = JSON.parse(localStorage.getItem('openshorts_local_editor_state_v1'));
            expect(saved.present.subtitleCues[0].startMs).toBe(6000);
        });

        localStorage.removeItem('openshorts_local_editor_state_v1');
        window.dispatchEvent(new Event('pagehide'));
        const flushed = JSON.parse(localStorage.getItem('openshorts_local_editor_state_v1'));
        expect(flushed.present.subtitleCues[0].startMs).toBe(6000);
    });

    it('adds and edits a hook, then resets', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockReturnValue(true);
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

    it('creates subtitle cues and confirms cue removal', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /add subtitle cue/i })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /add subtitle cue/i }));
        expect(screen.getByLabelText('Subtitle text')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete subtitle cue/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /delete subtitle cue/i }));
        expect(confirm).toHaveBeenCalledWith('Remove this subtitle cue?');
        expect(screen.getByLabelText('Subtitle text')).toBeInTheDocument();

        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByRole('button', { name: /delete subtitle cue/i }));
        expect(screen.queryByLabelText('Subtitle text')).not.toBeInTheDocument();
    });

    it('undoes and redoes subtitle edits', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /add subtitle cue/i })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /add subtitle cue/i }));
        fireEvent.change(screen.getByLabelText('Subtitle text'), { target: { value: 'Undo me' } });
        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        expect(screen.getByLabelText('Subtitle text')).toHaveValue('');
        fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
        expect(screen.getByLabelText('Subtitle text')).toHaveValue('Undo me');
    });

    it('undoes a multi-step subtitle cue drag as one action', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 1000, height: 100, top: 0, left: 0, right: 1000, bottom: 100 }));
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /add subtitle cue/i })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /add subtitle cue/i }));
        const cue = screen.getByRole('button', { name: 'Timeline cue' });
        act(() => cue.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0 })));
        act(() => {
            window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
            window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, bubbles: true }));
            window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, bubbles: true }));
        });
        expect(screen.getByRole('button', { name: 'Timeline cue' })).toHaveStyle({ left: '20%' });

        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        expect(screen.getByRole('button', { name: 'Timeline cue' })).toHaveStyle({ left: '0%' });
        fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
        expect(screen.getByRole('button', { name: 'Timeline cue' })).toHaveStyle({ left: '20%' });
    });

    it('exposes subtitle styling and removes the whole subtitle track', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<LocalEditorTab />);
        fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
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
        expect(screen.getByRole('button', { name: 'Show background box' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show background box' }));
        expect(screen.getByRole('button', { name: 'Hide background box' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hide background box' }));
        expect(screen.getByRole('button', { name: 'Show background box' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /remove subtitles/i }));
        expect(screen.queryByText('Hello')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export subtitles/i })).toBeDisabled();
    });
});
