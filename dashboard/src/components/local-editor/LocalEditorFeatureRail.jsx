import { LOCAL_EDITOR_FEATURES } from "./localEditorFeatures";

export default function LocalEditorFeatureRail({
  activeFeature = "details",
  onSelect,
}) {
  return (
    <nav
      aria-label="Editor features"
      className="flex gap-1 border-b border-white/10 bg-[#17171b] p-1.5 lg:flex-col lg:border-b-0 lg:border-r lg:p-2"
    >
      {LOCAL_EDITOR_FEATURES.map(({ id, label, title, icon: Icon }) => {
        const active = activeFeature === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            title={title || label}
            onClick={() => onSelect?.(id)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors lg:min-w-16 lg:flex-none ${active ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-300/30" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"}`}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
