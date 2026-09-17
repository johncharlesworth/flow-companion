import { Menu } from '@base-ui/react/menu';
import type { ReactElement, ReactNode } from 'react';

// A small action menu (the header's overflow). Arrow keys move, Enter
// selects, Escape closes and returns focus to the trigger.
export interface MenuItemSpec {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export function ActionMenu({ trigger, items }: { trigger: ReactElement; items: MenuItemSpec[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="min-w-[188px] rounded-popover bg-surface-elevated p-1 shadow-elevated outline-none">
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="flex h-9 cursor-default items-center gap-2 rounded-button px-3 text-[14px] text-text-1 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent-subtle"
              >
                {item.icon}
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
