import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EditorActionToolbar from './EditorActionToolbar';

describe('EditorActionToolbar', () => {
    it('exposes every card workflow inside the editor', () => {
        const actions = Object.fromEntries(['onAutoEdit', 'onConvertNativeShort', 'onSubtitles', 'onViralHook', 'onDubVoice', 'onPost', 'onDownload'].map((name) => [name, vi.fn()]));
        render(<EditorActionToolbar {...actions} />);

        expect(screen.getByRole('region', { name: 'Editor actions' })).toBeInTheDocument();
        ['Auto Edit', 'Convert to Native Short', 'Subtitles', 'Viral Hook', 'Dub Voice', 'Post', 'Download'].forEach((label) => fireEvent.click(screen.getByRole('button', { name: label })));
        Object.values(actions).forEach((action) => expect(action).toHaveBeenCalledOnce());
    });

    it('disables a workflow while it is processing', () => {
        render(<EditorActionToolbar onAutoEdit={vi.fn()} isEditing onConvertNativeShort={vi.fn()} onSubtitles={vi.fn()} onViralHook={vi.fn()} onDubVoice={vi.fn()} onPost={vi.fn()} onDownload={vi.fn()} />);
        expect(screen.getByRole('button', { name: /editing/i })).toBeDisabled();
    });
});
