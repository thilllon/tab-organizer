import { ChevronRight, Save, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { ExportMenu } from '@/dashboard/components/ExportMenu';
import { WindowTree } from '@/dashboard/components/WindowTree';
import { useSessionBody } from '@/dashboard/hooks/useSessionBody';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { historyOriginLabel } from '@/dashboard/lib/session-utils';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

export interface HistoryRowProps {
  summary: SessionSummary;
  /** True while a restore is running anywhere in the dashboard. */
  restoring: boolean;
  /** Runs through the Dashboard's `useRestore`, so the >100-tab confirm and the toast apply. */
  onRestore(session: Session): Promise<void>;
  /** Bubbles "Saved …" / "Exported …" up to the Dashboard's notice banner. */
  onNotice(message: string): void;
  /** Called once the snapshot is removed; this row is about to unmount, so move focus elsewhere. */
  onDeleted?(): void;
}

/**
 * One automatic snapshot (spec §12 Phase 3). Everything a snapshot can do that a saved session
 * cannot lives here: protect (exempt from the ring-buffer prune) and "Save as session" (copy it
 * into the saved list). Storage goes through `sessionRepo` only.
 */
export function HistoryRow({
  summary,
  restoring,
  onRestore,
  onNotice,
  onDeleted,
}: HistoryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const body = useSessionBody(expanded ? summary.id : null);
  const isProtected = summary.protected === true;
  // Set once the delete is confirmed: the dialog's close-time focus hand-off must not target this
  // row's Delete button, which unmounts together with the row (same pattern as SessionCard).
  const deletingRef = useRef(false);

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

  const handleProtect = (value: boolean) => {
    void run(() => sessionRepo.setProtected(summary.id, value));
  };

  const handleSaveAsSession = () => {
    void run(async () => {
      const saved = await sessionRepo.duplicateAsSaved(summary.id);
      onNotice(`Saved “${saved.name}”.`);
    });
  };

  const handleDelete = () => {
    deletingRef.current = true;
    setConfirmingDelete(false);
    void run(async () => {
      try {
        await sessionRepo.remove(summary.id);
      } catch (err) {
        deletingRef.current = false;
        throw err;
      }
      onDeleted?.();
    });
  };

  const handleRestore = () => {
    void run(async () => {
      // The body is only loaded when the row is expanded; fetch it on demand otherwise.
      const session = body.session ?? (await sessionRepo.get(summary.id));
      if (session === undefined) {
        setError('This snapshot no longer exists.');
        return;
      }
      await onRestore(session);
    });
  };

  return (
    <li className="rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{summary.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDateTime(summary.createdAt)} · {formatSessionMeta(summary)}
          </p>
        </div>

        <Badge variant="outline">{historyOriginLabel(summary.origin)}</Badge>

        <Switch
          checked={isProtected}
          disabled={busy}
          aria-label={isProtected ? 'Unprotect snapshot' : 'Protect snapshot'}
          onCheckedChange={handleProtect}
        />

        <Button size="xs" onClick={handleRestore} disabled={busy || restoring}>
          Restore
        </Button>
        <Button size="xs" variant="outline" onClick={handleSaveAsSession} disabled={busy}>
          <Save />
          Save as session
        </Button>
        {/* Snapshots export exactly like saved sessions; the body is read on demand. */}
        <ExportMenu
          summary={summary}
          session={body.session}
          size="icon-xs"
          onNotice={onNotice}
          onError={setError}
        />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Delete snapshot"
          disabled={busy}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 />
        </Button>
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {expanded && (
        <div className="mt-2">
          {body.loading && body.session === undefined && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {body.error !== undefined && <p className="text-xs text-destructive">{body.error}</p>}
          {body.session !== undefined && (
            // Plain overflow container, not Radix's ScrollArea — see SessionCard for why.
            <div className="max-h-96 overflow-y-auto">
              <div className="space-y-2 pr-3">
                {body.session.windows.map((window, index) => (
                  <WindowTree
                    // biome-ignore lint/suspicious/noArrayIndexKey: no stable window id
                    key={`window-${index}`}
                    window={window}
                    index={index}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DeleteSessionDialog
        title="Delete snapshot?"
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={handleDelete}
        onCloseAutoFocus={(event) => {
          // Radix would hand focus back to the Delete button, which unmounts with the row moments
          // later, dropping focus to <body>; the section header outlives both.
          if (deletingRef.current) {
            event.preventDefault();
            onDeleted?.();
          }
        }}
      />
    </li>
  );
}
