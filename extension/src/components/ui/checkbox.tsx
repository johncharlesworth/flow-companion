import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-default items-start gap-3 rounded-button px-2 py-2 hover:bg-accent-subtle">
      <BaseCheckbox.Root
        checked={checked}
        onCheckedChange={(next) => onChange(next)}
        className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-surface data-[checked]:border-accent data-[checked]:bg-accent"
      >
        <BaseCheckbox.Indicator className="text-accent-fg">
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <span className="flex flex-col">
        <span className="text-[14px] text-text-1">{label}</span>
        {description && <span className="text-xs text-text-3">{description}</span>}
      </span>
    </label>
  );
}
