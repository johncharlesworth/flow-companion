import { Menu } from '@base-ui/react/menu';
import { Check, ExternalLink } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { cn } from '@/lib/cn';
import { formatWindow, type Picker, type PickerItem, type ProviderId, ROLE_LABEL } from '@/lib/models';
import { PRICING_URL } from '@/lib/provider-links';

import { Tip } from './ui/tooltip';

// The one place models are chosen. Opened from the
// composer chip or from Settings. Arrow keys move, Enter picks, Escape
// returns focus to the trigger.
export interface ModelMenuProps {
  provider: ProviderId;
  picker: Picker;
  currentId: string;
  onSelect: (id: string) => void;
  onManageProviders: () => void;
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const SEARCH_THRESHOLD = 8;

export function ModelMenu({ provider, picker, currentId, onSelect, onManageProviders, trigger, open, onOpenChange }: ModelMenuProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const more = query ? picker.more.filter((m) => m.id.toLowerCase().includes(query.toLowerCase())) : picker.more;

  const row = (item: PickerItem) => (
    <Menu.Item
      key={item.id}
      disabled={item.tooSmall}
      onClick={() => onSelect(item.id)}
      className="flex cursor-default items-center gap-3 rounded-button px-3 py-2 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent-subtle"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] text-text-1">
          {item.label}
          {item.role === 'default' && <span className="ml-2 rounded-pill bg-accent-subtle px-1.5 py-0.5 text-[11px] font-medium text-accent">Default</span>}
        </span>
        <span className="text-xs text-text-3">{item.tooSmall ? 'too small for this flow' : item.role === 'more' ? '' : ROLE_LABEL[item.role]}</span>
      </span>
      <span className="text-xs text-text-3">{formatWindow(item.contextWindow)}</span>
      <Check className={cn('h-4 w-4 text-accent', item.id === currentId ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
    </Menu.Item>
  );

  return (
    <Menu.Root
      {...(open !== undefined ? { open } : {})}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        if (!next) {
          setMoreOpen(false);
          setQuery('');
        }
      }}
    >
      <Tip content="Choose a model" side="top">
        <Menu.Trigger render={trigger} />
      </Tip>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <Menu.Popup className="max-h-[70vh] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-popover bg-surface-elevated p-1 shadow-elevated outline-none">
            <p className="px-3 py-2 text-xs text-text-3">Switching models re-sends the whole flow once.</p>
            {picker.recommended.map(row)}
            {picker.more.length > 0 && (
              <Menu.Item
                closeOnClick={false}
                onClick={() => setMoreOpen((v) => !v)}
                className="flex cursor-default items-center gap-2 rounded-button px-3 py-2 text-[14px] text-text-2 outline-none data-[highlighted]:bg-accent-subtle"
              >
                <span className="flex-1">More models ({picker.more.length})</span>
                <span aria-hidden="true">{moreOpen ? '−' : '+'}</span>
              </Menu.Item>
            )}
            {moreOpen && picker.more.length > SEARCH_THRESHOLD && (
              <div className="px-2 py-1">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Search models"
                  aria-label="Search models"
                  className="w-full rounded-button border border-hairline bg-composer px-2 py-1 font-mono text-xs text-text-1 placeholder:text-text-3"
                />
              </div>
            )}
            {moreOpen && more.map(row)}
            <div className="mt-1 flex items-center justify-between border-t border-hairline px-3 py-2 text-xs">
              <a href={PRICING_URL[provider]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent">
                Pricing <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
              <Menu.Item onClick={onManageProviders} className="cursor-default text-accent outline-none data-[highlighted]:underline">
                Manage providers →
              </Menu.Item>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
