export default function LocalEditorFeaturePanel({
  title,
  children,
  className = "",
  overlay = null,
}) {
  return (
    <section
      data-testid="local-editor-feature-panel"
      aria-label={title}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden border-b border-white/10 bg-[#111114] lg:border-b-0 lg:border-r ${className}`}
    >
      <div
        data-testid="local-editor-feature-panel-scroll"
        className="editor-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
      >
        {children}
      </div>
      {overlay}
    </section>
  );
}
