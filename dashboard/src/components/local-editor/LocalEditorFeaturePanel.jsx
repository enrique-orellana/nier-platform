export default function LocalEditorFeaturePanel({ title, children }) {
  return (
    <section
      data-testid="local-editor-feature-panel"
      aria-label={title}
      className="min-h-0 overflow-y-auto border-b border-white/10 bg-[#111114] p-4 lg:border-b-0 lg:border-r"
    >
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
