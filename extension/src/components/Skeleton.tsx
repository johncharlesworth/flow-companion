// Loading: a skeleton of the header, the greeting line, and three chip-shaped
// blocks, with the composer rendered but disabled.

export function Skeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Reading the flow">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3 motion-safe:animate-pulse">
        <div className="h-3.5 flex-1 rounded-pill bg-hairline" />
        <div className="h-6 w-16 rounded-pill bg-hairline" />
        <div className="h-8 w-8 rounded-button bg-hairline" />
        <div className="h-8 w-8 rounded-button bg-hairline" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 motion-safe:animate-pulse">
        <div className="h-3.5 w-[60%] rounded-pill bg-hairline" />
        <div className="flex flex-wrap justify-center gap-2">
          <div className="h-8 w-24 rounded-pill bg-hairline" />
          <div className="h-8 w-36 rounded-pill bg-hairline" />
          <div className="h-8 w-32 rounded-pill bg-hairline" />
        </div>
      </div>
      <div className="px-3 pb-3">
        <p className="mb-2 text-center text-xs text-text-3">Large flows can take a few seconds</p>
        <div className="h-24 rounded-composer border border-hairline bg-composer opacity-60" />
      </div>
    </div>
  );
}
