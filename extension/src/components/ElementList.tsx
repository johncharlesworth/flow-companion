import { ChevronRight, Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { filterOutline, type FlowOutline, type OutlineItem, UNGROUPED_THRESHOLD } from '@/lib/flow-outline';

// One component for the Outline and the Explain picker:
// search pinned at top, groups collapsed by default, label plus API name in
// mono, keyboard navigable. Selecting does not send.
export function ElementList({ outline, onSelect, focusSearch = false }: { outline: FlowOutline; onSelect: (item: OutlineItem) => void; focusSearch?: boolean }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);
  const [open, setOpen] = useState(() => new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const ungrouped = outline.elementCount > UNGROUPED_THRESHOLD;
  const groups = useMemo(() => filterOutline(outline, query), [outline, query]);
  const searching = query.trim().length > 0;

  const rows = (items: OutlineItem[]) =>
    items.map((item) => (
      <button
        key={`${item.type}:${item.name}`}
        type="button"
        role="option"
        aria-selected={false}
        onClick={() => onSelect(item)}
        className="flex w-full flex-col items-start rounded-button px-3 py-1.5 text-left hover:bg-accent-subtle focus-visible:bg-accent-subtle"
      >
        <span className="text-[14px] text-text-1">{item.label}</span>
        <span className="font-mono text-xs text-text-3">{item.name}</span>
      </button>
    ));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const focusable = [...(listRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? Math.min(index + 1, focusable.length - 1) : Math.max(index - 1, 0);
    focusable[next]?.focus();
    e.preventDefault();
  };

  return (
    <div className="flex min-h-0 flex-col">
      <label className="relative mx-3 mb-2 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search elements"
          aria-label="Search elements"
          className="w-full rounded-button border border-hairline bg-composer py-1.5 pl-8 pr-2 text-[14px] text-text-1 placeholder:text-text-3"
        />
      </label>
      {ungrouped && <p className="mx-3 mb-2 text-xs text-text-3">Large flow: elements are listed without groups.</p>}
      <div ref={listRef} role="listbox" aria-label="Flow elements" tabIndex={-1} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-1">
        {groups.length === 0 && <p className="px-3 py-2 text-xs text-text-3">No elements match.</p>}
        {ungrouped || searching
          ? groups.flatMap((g) => rows(g.items))
          : groups.map((g) => {
              const isOpen = open.has(g.type);
              return (
                <div key={g.type}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.type)) next.delete(g.type);
                      else next.add(g.type);
                      return next;
                    })}
                    className="flex w-full items-center gap-1 rounded-button px-2 py-1.5 text-left text-[14px] font-medium text-text-2 hover:bg-accent-subtle"
                  >
                    <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} aria-hidden="true" />
                    <span className="flex-1">{g.label}</span>
                    <span className="text-xs text-text-3">{g.items.length}</span>
                  </button>
                  {isOpen && <div className="pb-1 pl-3">{rows(g.items)}</div>}
                </div>
              );
            })}
      </div>
    </div>
  );
}
