import { LOCAL_EDITOR_FEATURES } from "./localEditorFeatures";
import { Button } from "../ui";

export default function LocalEditorFeatureRail({
  activeFeature = "details",
  onSelect,
}) {
  return (
    <nav
      aria-label="Editor features"
      className="flex gap-1 border-b border-border bg-sidebar p-2 lg:flex-col lg:border-b-0 lg:border-r lg:p-2"
    >
      {LOCAL_EDITOR_FEATURES.map(({ id, label, title, icon: Icon }) => {
        const active = activeFeature === id;
        return (
          <Button
            variant={active ? "secondary" : "ghost"}
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            title={title || label}
            onClick={() => onSelect?.(id)}
            className="min-h-14 flex-1 flex-col gap-1 px-2 py-1.5 text-xs lg:min-w-16 lg:flex-none"
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </Button>
        );
      })}
    </nav>
  );
}
