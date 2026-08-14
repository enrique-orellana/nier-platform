import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Download, FileText, Play, Square, Sparkles, Terminal } from 'lucide-react';
import MinioObjectPicker from './MinioObjectPicker';
import { getApiUrl } from '../config';

const DEFAULT_MINUTES = 12;
const DEFAULT_IDEAL_MINUTES = 20;

const isActive = (status) => status === 'queued' || status === 'processing';

export default function HighlightsTab({ getAiHeaders, aiProvider }) {
    const [selected, setSelected] = useState(null);
    const [minMinutes, setMinMinutes] = useState(DEFAULT_MINUTES);
    const [idealMinutes, setIdealMinutes] = useState(DEFAULT_IDEAL_MINUTES);
    const [acknowledged, setAcknowledged] = useState(false);
    const [job, setJob] = useState(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState('');

    const loadLatest = useCallback(async () => {
        try {
            const response = await fetch(getApiUrl('/api/highlights'));
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || 'Could not load highlight jobs.');
            const latest = (payload.jobs || []).slice(-1)[0] || null;
            setJob(latest);
        } catch (fetchError) {
            setError(fetchError.message || 'Could not load highlight jobs.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadLatest(); }, [loadLatest]);

    useEffect(() => {
        if (!job || !isActive(job.status)) return undefined;
        const timer = setInterval(async () => {
            try {
                const response = await fetch(getApiUrl(`/api/status/${job.id}`));
                const payload = await response.json().catch(() => ({}));
                if (response.ok) setJob((current) => ({ ...current, ...payload }));
            } catch {
                // The next poll retries without interrupting the running job.
            }
        }, 1500);
        return () => clearInterval(timer);
    }, [job]);

    const canStart = Boolean(selected && acknowledged && !starting && !isActive(job?.status));
    const durationHint = useMemo(() => idealMinutes === minMinutes ? `At least ${minMinutes} minutes` : `At least ${minMinutes}, targeting about ${idealMinutes} minutes`, [idealMinutes, minMinutes]);

    const start = async () => {
        if (!canStart) return;
        setStarting(true);
        setError('');
        try {
            const response = await fetch(getApiUrl('/api/highlights'), {
                method: 'POST',
                headers: getAiHeaders('json'),
                body: JSON.stringify({
                    source_object: { bucket: selected.bucket, key: selected.key },
                    min_minutes: Number(minMinutes),
                    ideal_minutes: Number(idealMinutes),
                    acknowledged,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || 'Could not start highlight generation.');
            setJob(payload);
        } catch (startError) {
            setError(startError.message || 'Could not start highlight generation.');
        } finally {
            setStarting(false);
        }
    };

    const stop = async () => {
        if (!job?.id) return;
        setError('');
        try {
            const response = await fetch(getApiUrl(`/api/highlights/${job.id}`), { method: 'DELETE' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.detail || 'Could not stop highlight generation.');
            setJob(payload);
        } catch (stopError) {
            setError(stopError.message || 'Could not stop highlight generation.');
        }
    };

    const logs = job?.logs || [];
    const result = job?.result || null;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-6 md:p-10 animate-[fadeIn_0.3s_ease-out]">
            <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] uppercase tracking-wider text-primary font-semibold">
                            <Sparkles size={12} /> AI Highlights
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black text-white mt-3">Find the strongest parts</h1>
                        <p className="text-zinc-400 mt-2 max-w-2xl">Pick one downloaded MinIO video. OpenShorts transcribes it, scores meaningful sections with your configured AI, and renders one coherent long-form highlight video.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
                        Provider: <span className="text-white font-medium">{aiProvider || 'configured provider'}</span>
                    </div>
                </div>

                {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

                <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
                    <section className="glass-panel p-6 space-y-5">
                        <div className="flex items-center gap-3"><FileText size={20} className="text-primary" /><h2 className="text-lg font-semibold">Source video</h2></div>
                        <MinioObjectPicker selected={selected} onSelect={setSelected} />
                        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
                            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 accent-primary" />
                            <span>I confirm I own this video or have permission to process it.</span>
                        </label>
                    </section>

                    <section className="glass-panel p-6 space-y-5">
                        <div className="flex items-center gap-3"><Clock3 size={20} className="text-primary" /><h2 className="text-lg font-semibold">Output target</h2></div>
                        <p className="text-sm text-zinc-400">{durationHint}. If there is not enough strong material, the result stays shorter instead of adding filler.</p>
                        <label className="block text-sm text-zinc-300">Minimum minutes<input type="number" min="1" max="180" value={minMinutes} onChange={(event) => setMinMinutes(event.target.value)} className="input-field mt-2" /></label>
                        <label className="block text-sm text-zinc-300">Ideal minutes<input type="number" min="1" max="180" value={idealMinutes} onChange={(event) => setIdealMinutes(event.target.value)} className="input-field mt-2" /></label>
                        <button type="button" onClick={start} disabled={!canStart} className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                            <Play size={16} /> {starting ? 'Starting…' : 'Find and render highlights'}
                        </button>
                    </section>
                </div>

                {(loading || job) && <section className="glass-panel p-6 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3"><Activity size={20} className={isActive(job?.status) ? 'text-primary animate-pulse' : 'text-zinc-400'} /><h2 className="text-lg font-semibold">Generation status</h2><span className="text-xs uppercase tracking-wider text-zinc-500">{loading ? 'loading' : job?.status}</span></div>
                        {isActive(job?.status) && <button type="button" onClick={stop} className="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 text-sm flex items-center gap-2"><Square size={14} /> Stop</button>}
                    </div>
                    <div className="bg-[#0c0c0e] rounded-xl border border-white/10 overflow-hidden">
                        <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2 text-xs font-mono text-zinc-400"><Terminal size={12} /> Live worker logs</div>
                        <div className="p-4 min-h-28 max-h-64 overflow-y-auto font-mono text-xs space-y-2 text-zinc-400">
                            {logs.length ? logs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>) : <span className="text-zinc-600">Waiting for the worker…</span>}
                        </div>
                    </div>
                    {job?.error && <p className="text-sm text-red-300">{job.error}</p>}
                    {result && job?.status === 'completed' && <div className="space-y-4">
                        <video controls className="w-full max-h-[32rem] rounded-xl bg-black" src={getApiUrl(result.video_url)} />
                        <div className="flex flex-wrap gap-3">
                            <a href={getApiUrl(result.video_url)} download className="btn-primary px-4 py-2 flex items-center gap-2"><Download size={15} /> Download highlights</a>
                            <a href={getApiUrl(result.manifest_url)} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 flex items-center gap-2"><FileText size={15} /> View manifest</a>
                        </div>
                    </div>}
                </section>}
            </div>
        </div>
    );
}
