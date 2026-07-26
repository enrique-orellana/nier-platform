import { describe, expect, it, vi } from 'vitest';
import { saveAndRenderVersion } from './renderVersion';

describe('saveAndRenderVersion', () => {
    it('creates, renders, polls, and completes an immutable child version', async () => {
        const api = {
            createVersion: vi.fn().mockResolvedValue({ version: { version_id: 'v4' } }),
            startRender: vi.fn().mockResolvedValue({ renderId: 'r1' }),
            getRenderStatus: vi.fn().mockResolvedValue({ status: 'done', outputUrl: '/videos/job/v4.mp4' }),
            completeVersion: vi.fn().mockResolvedValue({ version: { version_id: 'v4', status: 'done' } }),
        };
        const result = await saveAndRenderVersion({ api, jobId: 'job', clipIndex: 0, manifest: { layers: {} }, parentVersionId: 'v3', props: { fps: 30 }, pollMs: 0 });
        expect(api.createVersion).toHaveBeenCalledWith(expect.objectContaining({ parent_version_id: 'v3' }));
        expect(api.startRender).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'v4', props: { fps: 30 } }));
        expect(api.completeVersion).toHaveBeenCalledWith(expect.objectContaining({ output_url: '/videos/job/v4.mp4' }));
        expect(result.status).toBe('done');
    });

    it('marks a failed render without promoting the current output', async () => {
        const api = {
            createVersion: vi.fn().mockResolvedValue({ version: { version_id: 'v4' } }),
            startRender: vi.fn().mockResolvedValue({ renderId: 'r1' }),
            getRenderStatus: vi.fn().mockResolvedValue({ status: 'error', error: 'duration mismatch' }),
            completeVersion: vi.fn().mockResolvedValue({ version: { version_id: 'v4', status: 'failed' } }),
            promote: vi.fn(),
        };
        const result = await saveAndRenderVersion({ api, jobId: 'job', clipIndex: 0, manifest: {}, parentVersionId: 'v3', props: {}, pollMs: 0 });
        expect(result.status).toBe('failed');
        expect(api.completeVersion).toHaveBeenCalledWith(expect.objectContaining({ error: 'duration mismatch' }));
        expect(api.promote).not.toHaveBeenCalled();
    });
});
