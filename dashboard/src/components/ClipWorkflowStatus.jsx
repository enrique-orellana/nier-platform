import { CLIP_WORKFLOW_STATUSES } from './clipWorkflowStatuses';

export default function ClipWorkflowStatus({
  status = 'not_reviewed',
  saving = false,
  onChange,
}) {
  const currentStatus = CLIP_WORKFLOW_STATUSES.some((item) => item.value === status)
    ? status
    : 'not_reviewed';
  const currentDefinition = CLIP_WORKFLOW_STATUSES.find((item) => item.value === currentStatus);

  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${currentDefinition.className}`}>
        {currentDefinition.label}
      </span>
      <select
        aria-label="Clip status"
        value={currentStatus}
        disabled={saving}
        onChange={(event) => onChange?.(event.target.value)}
        className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-200 outline-none transition-colors focus:border-cyan-400/50 disabled:cursor-wait disabled:opacity-60"
      >
        {CLIP_WORKFLOW_STATUSES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
