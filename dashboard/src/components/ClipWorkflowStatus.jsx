export const CLIP_WORKFLOW_STATUSES = [
  {
    value: 'not_reviewed',
    label: 'Not reviewed',
    className: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/20',
  },
  {
    value: 'reviewing',
    label: 'Reviewing',
    className: 'bg-amber-500/15 text-amber-300 border-amber-400/20',
  },
  {
    value: 'editing',
    label: 'Editing',
    className: 'bg-blue-500/15 text-blue-300 border-blue-400/20',
  },
  {
    value: 'edited',
    label: 'Edited',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20',
  },
  {
    value: 'published',
    label: 'Published',
    className: 'bg-violet-500/15 text-violet-300 border-violet-400/20',
  },
];

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
