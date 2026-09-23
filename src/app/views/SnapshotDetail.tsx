import { BookmarkPlus, Ellipsis, ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { openSavedTab } from '@/app/lib/open-saved-tab';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { ExportMenu } from '@/dashboard/components/ExportMenu';
import { WindowTree } from '@/dashboard/components/WindowTree';
import { useSessionBody } from '@/dashboard/hooks/useSessionBody';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { historyOriginLabel } from '@/dashboard/lib/session-utils';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

export interface SnapshotDetailProps {
  summary: SessionSummary;
  restoring: boolean;
  /** How many snapshots are kept before the oldest unkept one is dropped. */
  keepLast: number;
  onOpen(session: Session): Promise<void>;
  onNotice(message: string): void;
  /** The snapshot became a saved session; its new id is where the view should go. */
  onKept(savedId: string): void;
  onDeleted(): void;
}

/**
 * One automatic snapshot. Two actions only: open it, or keep it — "keep" moves it into the saved
 * list, which is the whole of what the old `protected` flag meant, without a word the user has to
 * learn. Snapshots are not editable: they are a record of what was open, not a document.
 */
export function SnapshotDetail({
  summary,
  restoring,
  keepLast,
  onOpen,
  onNotice,
  onKept,
  onDeleted,
}: SnapshotDetailProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const body = useSessionBody(summary.id);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = () =>
    run(async () => {
      const session = body.session ?? (await sessionRepo.get(summary.id));
      if (session === undefined) {
        setError('This snapshot no longer exists.');
        return;
      }
      await onOpen(session);
    });

  /** Copy into the saved list, then drop the snapshot: from the user's side it moved. */
  const handleKeep = () =>
    run(async () => {
      const saved = await sessionRepo.duplicateAsSaved(summary.id);
      await sessionRepo.remove(summary.id);
      onNotice(`Kept as “${saved.name}”.`);
      onKept(saved.id);
    });

  const handleDelete = () => {
    setConfirmingDelete(false);
    void run(async () => {
      await sessionRepo.remove(summary.id);
      onDeleted();
    });
  };

  return (
    <section aria-label={`Snapshot ${formatDateTime(summary.createdAt)}`} className="min-w-0">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{formatDateTime(summary.createdAt)}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {historyOriginLabel(summary.origin)} · {formatSessionMeta(summary)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void handleOpen()} disabled={busy || restoring}>
            <ExternalLink />
            Open
          </Button>
          <Button variant="outline" onClick={() => void handleKeep()} disabled={busy}>
            <BookmarkPlus />
            Keep
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ExportMenu
            summary={summary}
            session={body.session}
            onNotice={onNotice}
            onError={setError}
          />
        </div>
      </header>

      <p className="mt-3 text-xs text-muted-foreground">
        Snapshots are taken automatically and only the last {keepLast} are kept. Press{' '}
        <strong>Keep</strong> to move this one to your saved sessions, where nothing removes it.
      </p>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4">
        {body.loading && body.session === undefined && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {body.error !== undefined && <p className="text-sm text-destructive">{body.error}</p>}
        {body.session !== undefined && (
          // The ARIA group holding this snapshot's window nodes; no HTML element carries it.
          <div role="tree" aria-label="Windows in this snapshot" className="space-y-2">
            {body.session.windows.map((window, index) => (
              <WindowTree
                // biome-ignore lint/suspicious/noArrayIndexKey: no stable window id
                key={`window-${index}`}
                window={window}
                index={index}
                onOpenTab={async (tabIndex) => {
                  const result = await openSavedTab(window.tabs[tabIndex].url);
                  if (!result.ok) {
                    return result.reason;
                  }
                  if (result.switched) {
                    onNotice('That tab was already open — switched to it.');
                  }
                  return undefined;
                }}
              />
            ))}
          </div>
        )}
      </div>

      <DeleteSessionDialog
        name={formatDateTime(summary.createdAt)}
        title="Delete snapshot?"
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={handleDelete}
      />
    </section>
  );
}
