import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  id?: string;
  title?: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onValueChange(value: string): void;
}

/**
 * Every dropdown in Settings. The list opens just below the control (`position="popper"`), where a
 * native `<select>` on macOS opens over it with the chosen item laid on top of the control.
 */
export function SelectMenu({
  id,
  title,
  value,
  options,
  disabled,
  onValueChange,
}: SelectMenuProps) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger id={id} title={title} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
