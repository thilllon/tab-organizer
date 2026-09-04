import { AppWindow, Save, SquareArrowOutUpRight, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloseWindowDialog } from '@/dashboard/components/CloseWindowDialog';
import { WindowTree } from '@/dashboard/components/WindowTree';
import type { OpenWindowView } from '@/dashboard/lib/open-windows';
import { closeTab, closeWindow, goToTab } from '@/dashboard/lib/window-actions';

export interface OpenWindowsPaneProps {
  windows: OpenWindowView[];
  /** The window this dashboard tab is in; it gets the "This window" marker. */
  currentWindowId?: number;
  loading: boolean;
  error?: string;
  /** Saves that live window as a session; the Dashboard owns the notice/error banners. */
  onSaveWindow(windowId: number): void;
  /** Disables the save buttons while a save or a restore is running. */
  busy?: boolean;
}

interface PendingClose {
  windowId: number;
  windowNumber: number;
  tabCount: number;
  isCurrent: boolean;
}

/**
 * Live list of the open windows, as the same window → group → tab tree the saved sessions use
 * (`WindowTree`), plus the actions that only make sense on a live window. Every chrome call goes
 * through `window-actions.ts`; the pane never touches the service worker.
 */
export function OpenWindowsPane({
  windows,
  currentWindowId,
  loading,
  error,
  onSaveWindow,
  busy,
}: OpenWindowsPaneProps) {
  const [pendingClose, setPendingClose] = useState<PendingClose | undefined>(undefined);
  // Radix keeps the dialog mounted through its close animation; the last pending value keeps its
  // text from flashing empty while it fades out.
  const [lastClose, setLastClose] = useState<PendingClose | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const requestClose = (pending: PendingClose) => {
    setActionError(undefined);
    setPendingClose(pending);
    setLastClose(pending);
  };

  const confirmClose = () => {
    const pending = pendingClose;
    setPendingClose(undefined);
    if (pending === undefined) {
      return;
    }
    void closeWindow(pending.windowId).then((result) => {
      setActionError(result.ok ? undefined : result.reason);
    });
  };

  const removeTab = (tabId: number) => {
    void closeTab(tabId).then((result) => {
      setActionError(result.ok ? undefined : result.reason);
    });
  };

  const activateTab = (tabId: number, windowId: number) => {
    void goToTab(tabId, windowId).then((result) => {
      setActionError(result.ok ? undefined : result.reason);
    });
  };

  const shown = pendingClose ?? lastClose;

  return (
    <section aria-labelledby="open-windows-heading" className="min-w-0">
      <div className="flex items-center gap-2">
        <h2 id="open-windows-heading" className="text-sm font-semibold">
          Open windows
        </h2>
        <span className="text-xs text-muted-foreground">{windows.length}</span>
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {actionError !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {actionError}
        </p>
      )}

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : windows.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <AppWindow className="size-4" />
          No open windows to show.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {windows.map((window, index) => (
            <WindowTree
              key={window.windowId}
              window={window}
              index={index}
              badge={
                window.windowId === currentWindowId ? (
                  <Badge variant="secondary">This window</Badge>
                ) : undefined
              }
              actions={
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onSaveWindow(window.windowId)}
                    disabled={busy}
                  >
                    <Save />
                    Save this window
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      requestClose({
                        windowId: window.windowId,
                        windowNumber: index + 1,
                        tabCount: window.tabs.length,
                        isCurrent: window.windowId === currentWindowId,
                      })
                    }
                  >
                    <X />
                    Close window
                  </Button>
                </>
              }
              onOpenTab={async (tabIndex) => {
                const tab = window.tabs[tabIndex];
                if (tab === undefined) {
                  return undefined;
                }
                const result = await goToTab(tab.tabId, window.windowId);
                return result.ok ? undefined : result.reason;
              }}
              renderTabActions={(tabIndex) => {
                const tab = window.tabs[tabIndex];
                if (tab === undefined) {
                  return undefined;
                }
                return (
                  <>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Go to tab"
                      onClick={() => activateTab(tab.tabId, window.windowId)}
                    >
                      <SquareArrowOutUpRight />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Close tab"
                      onClick={() => removeTab(tab.tabId)}
                    >
                      <X />
                    </Button>
                  </>
                );
              }}
            />
          ))}
        </div>
      )}

      <CloseWindowDialog
        windowNumber={shown?.windowNumber}
        tabCount={shown?.tabCount ?? 0}
        isCurrent={shown?.isCurrent ?? false}
        open={pendingClose !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setPendingClose(undefined);
          }
        }}
        onConfirm={confirmClose}
      />
    </section>
  );
}
