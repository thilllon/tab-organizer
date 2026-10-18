import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

interface SettingsFieldProps {
  label: string;
  hint?: string;
  /** The id of the control this label names; given, the label is a real `<label>`. */
  htmlFor?: string;
  children: ReactNode;
}

/** One row of the Settings dialog: a label (and grey hint) on the left, the control on the right. */
export function SettingsField({ label, hint, htmlFor, children }: SettingsFieldProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-48 flex-1">
        {htmlFor === undefined ? (
          <p className="text-sm">{label}</p>
        ) : (
          <Label htmlFor={htmlFor} className="leading-normal font-normal">
            {label}
          </Label>
        )}
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {/* The hint doubles as the control's tooltip: a title on the wrapper reaches every control
          inside it that has no title of its own. */}
      <div className="flex items-center gap-2" title={hint}>
        {children}
      </div>
    </div>
  );
}
