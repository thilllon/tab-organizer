import { NOT_SET } from '@/lib/command-rows';

interface ShortcutKeyChipsProps {
  keys: readonly string[];
}

/** One shortcut as small key chips joined by "+", or a grey "Not set". */
export function ShortcutKeyChips({ keys }: ShortcutKeyChipsProps) {
  if (keys.length === 0) {
    return <span className="text-xs text-muted-foreground">{NOT_SET}</span>;
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {keys.map((key, index) => (
        <span key={key} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden="true">+</span>}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs text-foreground">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
}
