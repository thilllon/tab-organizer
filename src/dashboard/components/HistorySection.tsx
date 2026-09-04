import { ChevronRight, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DeleteAllHistoryDialog } from '@/dashboard/components/DeleteAllHistoryDialog';
import { HistoryRow } from '@/dashboard/components/HistoryRow';
import { errorMessage } from '@/dashboard/lib/errors';
import { pluralize } from '@/dashboard/lib/format';
import { HISTORY_OPEN_KEY, readUiState, writeUiState } from '@/dashboard/lib/ui-state';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

export interface HistorySectionProps {
  /** `kind: 'history'` summaries, newest first (see `splitByKind`). */
  summaries: SessionSummary[];
  restoring: boolean;
  onRestore(session: Session): Promise<void>;
  onNotice(message: string): void;
}

/**
 * The automatic snapshots (spec §12 Phase 3), below the saved list and collapsed by default —
 * they are a safety net, not the main list. The open state is remembered per dashboard tab in
 * `sessionStorage`, so expanding it survives the re-render but not a new tab.
 */
export function HistorySection({ summaries, restoring, onRestore, onNotice }: HistorySectionProps) {
  const [open, setOpen] = useState(() => readUiState(HISTORY_OPEN_KEY) === 'true');
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // Focus target after a row deletes itself: the row (and the button that had focus) unmounts,
  // which would otherwise drop keyboard focus to <body>. The section header outlives every row.
  const triggerRef = useRef<HTMLButtonElement>(null);

  const unprotected = summaries.filter((summary) => summary.protected !== true).length;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    writeUiState(HISTORY_OPEN_KEY, String(next));
  };

  const handleDeleteAll = () => {
    setConfirmingDeleteAll(false);
    setBusy(true);
    void (async () => {
      try {
        const removed = await sessionRepo.removeAllHistory({ unprotectedOnly: true });
        setError(undefined);
        onNotice(`Deleted ${pluralize(removed.length, 'unprotected snapshot')}.`);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section aria-labelledby="history-heading" className="mt-6">
      <Collapsible open={open} onOpenChange={handleOpenChange}>
        <div className="flex flex-wrap items-center gap-2">
          {/* The heading wraps the trigger (rather than the other way round): a <button> may not
              contain a heading, and the section still needs one to label it. */}
          <h2 id="history-heading" className="text-sm font-semibold">
            <CollapsibleTrigger asChild>
              <Button ref={triggerRef} variant="ghost" size="sm" className="-ml-2 px-2">
                <ChevronRight className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                History
                <span className="text-xs font-normal text-muted-foreground">
                  {summaries.length}
                </span>
              </Button>
            </CollapsibleTrigger>
          </h2>
          {summaries.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto"
              disabled={busy || unprotected === 0}
              onClick={() => setConfirmingDeleteAll(true)}
            >
              <Trash2 />
              Delete all unprotected
            </Button>
          )}
        </div>

        {error !== undefined && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <CollapsibleContent>
          {summaries.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No snapshots yet. Automatic snapshots of all your windows are on by default and are
              kept only on this device.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {summaries.map((summary) => (
                <HistoryRow
                  key={summary.id}
                  summary={summary}
                  restoring={restoring}
                  onRestore={onRestore}
                  onNotice={onNotice}
                  onDeleted={() => triggerRef.current?.focus({ preventScroll: true })}
                />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>

      <DeleteAllHistoryDialog
        count={unprotected}
        open={confirmingDeleteAll}
        onOpenChange={setConfirmingDeleteAll}
        onConfirm={handleDeleteAll}
      />
    </section>
  );
}
