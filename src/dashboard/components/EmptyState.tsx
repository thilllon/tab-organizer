import { FolderOpen, Keyboard, Layers, MousePointerClick, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openShortcutSettings } from '@/sessions/shortcuts';

export interface EmptyStateProps {
  onSaveWindow(): void;
  onSaveAll(): void;
  saving: boolean;
  running: boolean;
}

export function EmptyState({ onSaveWindow, onSaveAll, saving, running }: EmptyStateProps) {
  return (
    <section className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center">
      <FolderOpen className="size-10 text-muted-foreground" />
      <div>
        <h2 className="text-base font-medium">No saved sessions yet</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          A session is a snapshot of your windows, tabs and tab groups, stored only on this device.
          Save one now, or later from anywhere:
        </p>
      </div>
      <ul className="max-w-md space-y-2 text-left text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <MousePointerClick className="mt-0.5 size-4 shrink-0" />
          <span>
            Right-click the Tab Organizer icon → <strong>Save this window as session</strong> or{' '}
            <strong>Save all windows as session</strong>. A ✓ badge confirms the save.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Keyboard className="mt-0.5 size-4 shrink-0" />
          <span>
            Assign keyboard shortcuts for "Save the current window as a session" and "Open the
            Sessions dashboard".
          </span>
        </li>
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onSaveWindow} disabled={saving || running}>
          <Save />
          Save this window
        </Button>
        <Button size="sm" onClick={onSaveAll} disabled={saving || running}>
          <Layers />
          Save all windows
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            openShortcutSettings().catch((err) => console.error('[tab-organizer:sessions]', err));
          }}
        >
          <Keyboard />
          Set keyboard shortcuts
        </Button>
      </div>
    </section>
  );
}
