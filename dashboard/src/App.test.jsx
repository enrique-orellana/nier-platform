import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App settings layout', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/settings');
        localStorage.clear();
        localStorage.setItem('ai_provider_v1', 'openai-codex');
        vi.stubGlobal('fetch', vi.fn((url) => {
            if (String(url).includes('/api/ai/openai-codex/status')) {
                return Promise.resolve({ ok: true, json: async () => ({ connected: true, pending: false }) });
            }
            if (String(url).includes('/api/ai/openai-codex/models')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        models: [{ id: 'gpt-5.4', label: 'GPT-5.4', supportsVision: true }],
                        defaultModel: 'gpt-5.4',
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }));
    });

    afterEach(() => {
        window.history.pushState({}, '', '/');
        localStorage.clear();
        vi.unstubAllGlobals();
    });

    it('does not nest block grids inside paragraph elements', () => {
        const { container } = render(<App />);

        expect(container.querySelectorAll('p > div')).toHaveLength(0);
    });

    it('makes the idle clip generator content vertically scrollable', () => {
        window.history.pushState({}, '', '/');
        const { container } = render(<App />);

        expect(container.querySelector('[data-testid="dashboard-scroll-container"]')).toBeInTheDocument();
    });

    it('loads the account-available Codex models after the connection is ready', async () => {
        render(<App />);

        expect(await screen.findAllByRole('option', { name: 'GPT-5.4' })).toHaveLength(3);
    });

    it('preserves a persisted Codex model when the account catalog still provides it', async () => {
        localStorage.setItem('ai_text_model_v1', 'gpt-5.4');
        render(<App />);

        await screen.findAllByRole('option', { name: 'GPT-5.4' });
        expect(screen.getByRole('combobox', { name: 'Text Model' })).toHaveValue('gpt-5.4');
    });
});
