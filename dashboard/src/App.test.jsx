import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App settings layout', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/settings');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    });

    afterEach(() => {
        window.history.pushState({}, '', '/');
        vi.unstubAllGlobals();
    });

    it('does not nest block grids inside paragraph elements', () => {
        const { container } = render(<App />);

        expect(container.querySelectorAll('p > div')).toHaveLength(0);
    });
});
