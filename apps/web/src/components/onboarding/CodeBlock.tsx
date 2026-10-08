export default function CodeBlock({ code }: { code: string }) {
  return (
    <pre data-testid="snippet" className="overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-slate-950 p-4 font-mono text-[13.5px] leading-relaxed text-teal-100">
      <code>{code}</code>
    </pre>
  );
}
