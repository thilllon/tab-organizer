import type { ReactNode } from 'react';

interface AdvancedFoldProps {
  label: string;
  description: string;
  children: ReactNode;
}

/**
 * The settings people rarely change, folded away. `<details>` rather than a toggle so the browser
 * owns the open state and keyboard behaviour. The marker is a solid triangle drawn centred in
 * its own box, so it lines up with the label and turns from right to down on open; `description`
 * says in small grey text which settings are inside.
 */
export function AdvancedFold({ label, description, children }: AdvancedFoldProps) {
  return (
    <details className="group -mx-2 rounded-md px-2">
      <summary
        title="Show or hide more settings"
        className="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 pr-2 pl-3 text-sm font-medium text-foreground/80 hover:bg-muted"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 10 10"
          className="size-3.5 shrink-0 text-primary transition-transform group-open:rotate-90"
        >
          <path d="M2 0.5 9.5 5 2 9.5Z" fill="currentColor" />
        </svg>
        <span>{label}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </summary>
      <div className="space-y-5 py-3">{children}</div>
    </details>
  );
}
