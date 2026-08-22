export default function LocalEditorFeaturePanel({
  title,
  children,
  className = "",
}) {
  return (
    <section
      data-testid="local-editor-feature-panel"
      aria-label={title}
      className={`editor-scrollbar min-h-0 overflow-x-hidden overflow-y-auto border-b border-white/10 bg-[#111114] p-4 lg:border-b-0 lg:border-r ${className}`}
    >
      {children}
    </section>
  );
}
