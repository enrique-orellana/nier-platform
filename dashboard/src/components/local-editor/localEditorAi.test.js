import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalAiHeaders, subtitleTextFromCues } from './localEditorAi';

describe('local editor AI helpers', () => {
    beforeEach(() => localStorage.clear());

    it('serializes current subtitle cues', () => {
        expect(subtitleTextFromCues([{ text: 'Hola' }, { text: 'mundo' }])).toBe('Hola mundo');
    });

    it('reads local AI settings', () => {
        localStorage.setItem('ai_provider_v1', 'lmstudio');
        localStorage.setItem('ai_base_url_v1', 'http://localhost:1234');

        expect(getLocalAiHeaders()).toMatchObject({
            'X-AI-Provider': 'lmstudio',
            'X-AI-Base-Url': 'http://localhost:1234',
        });
    });
});
