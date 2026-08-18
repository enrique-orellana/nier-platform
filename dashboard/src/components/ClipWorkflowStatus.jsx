import React from "react";
import { CLIP_WORKFLOW_STATUSES } from "./clipWorkflowStatuses";

export default function ClipWorkflowStatus({
  status = "not_reviewed",
  saving = false,
  onChange,
}) {
  const currentStatus = CLIP_WORKFLOW_STATUSES.some(
    (item) => item.value === status,
  )
    ? status
    : "not_reviewed";
  const currentDefinition = CLIP_WORKFLOW_STATUSES.find(
    (item) => item.value === currentStatus,
  );

  return (
    <div className="mb-2.5 flex items-center justify-between gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-2 py-1.5 min-w-0">
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider shrink-0 ${currentDefinition.className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        <span className="truncate">{currentDefinition.label}</span>
      </span>
      <select
        aria-label="Clip status"
        value={currentStatus}
        disabled={saving}
        onChange={(event) => onChange?.(event.target.value)}
        className="min-w-0 max-w-[115px] sm:max-w-none shrink-0 rounded-lg border border-white/10 bg-black/60 px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs text-zinc-200 outline-none transition-colors hover:border-white/20 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
      >
        {CLIP_WORKFLOW_STATUSES.map((item) => (
          <option
            key={item.value}
            value={item.value}
            className="bg-zinc-900 text-white"
          >
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
