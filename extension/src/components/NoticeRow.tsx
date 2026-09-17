// A transcript row for system notes: centred, 12px, text-3, hairline rules either side.
export function NoticeRow({ children }: { children: string }) {
  return (
    <div className="my-3 flex items-center gap-3 px-3 text-xs text-text-3" role="status">
      <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
      <span className="max-w-[40ch] text-center">{children}</span>
      <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
    </div>
  );
}
