import { FileWarning, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime } from '@/dashboard/lib/format';
import { UNREADABLE_SESSION_MESSAGE, unreadableSchemaLabel } from '@/dashboard/lib/session-utils';
import { sessionRepo } from '@/sessions/storage';
import type { SessionSummary, UnreadableSession } from '@/types';

export interface UnreadableSessionRowProps {
  summary: SessionSummary;
  /** The marker `reconcile()` put on the index entry; carries the schema version that wrote it. */
  unreadable: UnreadableSession;
  /** Called once the row is removed; it is about to unmount, so move focus elsewhere. */
  onDeleted?(): void;
}

/**
 * A saved-list row for a session whose body was written by a newer Tab Organizer (spec §3): the
 * body is on disk and intact, this build simply cannot migrate it, so the row says so instead of
 * pretending the session is gone.
 *
 * Everything that would have to read the body — restore, rename, export, expanding the tree — is
 * absent rather than disabled-looking: there is nothing to click. Delete stays, because it only
 * needs the index entry and the key, and a user who does not want to update must still be able to
 * clear the entry. `remove()` never reads the body, so it works here exactly as it does elsewhere.
 */
export function UnreadableSessionRow({
  summary,
  unreadable,
  onDeleted,
}: UnreadableSessionRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // As in SessionCard: the dialog's close-time focus hand-off must not target a button that
  // unmounts with this row.
  const deletingRef = useRef(false);

  const handleDelete = async () => {
    deletingRef.current = true;
    setConfirming(false);
    try {
      await sessionRepo.remove(summary.id);
      onDeleted?.();
    } catch (err) {
      deletingRef.current = false;
      setError(errorMessage(err));
    }
  };

  return (
    <li
      role="treeitem"
      aria-label={summary.name}
      // No `aria-disabled` on the row: it would mark the Delete button inside it disabled too --
      // both to assistive technology and to anything applying ARIA state (a real Chrome check
      // found Playwright refusing to click it) -- and Delete is the one action that must work
      // here. The row carries no other control, so its inertness needs no announcing beyond the
      // sentence it renders.
      tabIndex={0}
      className="rounded-lg border border-dashed bg-muted/30 p-4 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        <FileWarning className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-muted-foreground">{summary.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {UNREADABLE_SESSION_MESSAGE}
            {' · '}
            {unreadableSchemaLabel(unreadable)}
            {summary.updatedAt > 0 ? ` · saved ${formatDateTime(summary.updatedAt)}` : ''}
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Delete session"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </Button>
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <DeleteSessionDialog
        name={summary.name}
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void handleDelete()}
        onCloseAutoFocus={(event) => {
          if (deletingRef.current) {
            event.preventDefault();
            onDeleted?.();
          }
        }}
      />
    </li>
  );
}
