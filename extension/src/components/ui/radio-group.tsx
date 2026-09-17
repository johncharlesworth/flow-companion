import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function RadioGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  'aria-label': string;
}) {
  return (
    <BaseRadioGroup
      name={name}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={ariaLabel}
      className="flex flex-col gap-1"
    >
      {options.map((option) => (
        <label key={option.value} className="flex cursor-default items-start gap-3 rounded-button px-2 py-2 hover:bg-accent-subtle">
          <Radio.Root
            value={option.value}
            className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface data-[checked]:border-accent data-[checked]:bg-accent"
          >
            <Radio.Indicator className="h-[6px] w-[6px] rounded-full bg-accent-fg" />
          </Radio.Root>
          <span className="flex flex-col">
            <span className="text-[14px] text-text-1">{option.label}</span>
            {option.description && <span className="text-xs text-text-3">{option.description}</span>}
          </span>
        </label>
      ))}
    </BaseRadioGroup>
  );
}
