import { Keyboard, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OpenWindowsPane } from '@/dashboard/components/OpenWindowsPane';
import type { OpenWindowsState } from '@/dashboard/hooks/useOpenWindows';
import { pluralize } from '@/dashboard/lib/format';

export interface OpenTabsViewProps {
  openWindows: OpenWindowsState;
  busy: boolean;
  /** How many sessions are already saved: the first-run hint only shows while there are none. */
  savedCount: number;
  onSaveAll(): void;
  onSaveWindow(windowId: number): void;
  onOpenSettings(): void;
}

/**
 * The default view: what is open right now, and one button that saves it. The button says what it
 * will take — "Save all windows" is a different promise from "Save this window", and the user
 * should not have to count their windows to know which one they are pressing. Saving a single
 * window stays on that window's row, where it belongs.
 */
export function OpenTabsView({
  openWindows,
  busy,
  savedCount,
  onSaveAll,
  onSaveWindow,
  onOpenSettings,
}: OpenTabsViewProps) {
  const windowCount = openWindows.windows.length;
  const tabCount = openWindows.windows.reduce((count, win) => count + win.tabs.length, 0);
  const saveLabel = windowCount > 1 ? 'Save all windows' : 'Save this window';

  return (
    <section aria-label="Open tabs" className="min-w-0">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Open tabs</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {pluralize(windowCount, 'window')} · {pluralize(tabCount, 'tab')}
          </p>
        </div>
        <Button onClick={onSaveAll} disabled={busy || windowCount === 0}>
          <Save />
          {saveLabel}
        </Button>
      </header>

      {savedCount === 0 && (
        <p className="mt-4 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Nothing saved yet. Press <strong>{saveLabel}</strong>, or right-click the Tab Organizer
          icon and choose <strong>Save all windows as session</strong>. To use a keyboard shortcut,{' '}
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1 rounded-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Keyboard className="size-3.5" />
            set one in Settings
          </button>
          .
        </p>
      )}

      <div className="mt-4">
        <OpenWindowsPane
          windows={openWindows.windows}
          currentWindowId={openWindows.currentWindowId}
          loading={openWindows.loading}
          error={openWindows.error}
          onSaveWindow={onSaveWindow}
          busy={busy}
          showHeading={false}
        />
      </div>
    </section>
  );
}
