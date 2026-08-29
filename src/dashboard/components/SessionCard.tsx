import { ChevronRight, Ellipsis, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { WindowTree } from '@/dashboard/components/WindowTree';
import { useSessionBody } from '@/dashboard/hooks/useSessionBody';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

export interface SessionCardProps {
  summary: SessionSummary;
  restoring: boolean;
  onRestore(session: Session): Promise<void>;
  onRestoreWindow(session: Session, windowIndex: number): Promise<void>;
}

export function SessionCard({ summary, restoring, onRestore, onRestoreWindow }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const body = useSessionBody(expanded ? summary.id : null);
  // Set when Rename is picked in the dropdown: Radix returns focus to the trigger on close
  // (`onCloseAutoFocus`), which blurs the freshly mounted input and commits the rename
  // immediately, ending the edit before the user can type. See the guard on the content below.
  const renameRequestedRef = useRef(false);

  const startRename = () => {
    setDraft(summary.name);
    setEditing(true);
  };

  const commitRename = async () => {
    setEditing(false);
    const name = draft.trim();
    if (name.length === 0 || name === summary.name) {
      return;
    }
    try {
      await sessionRepo.rename(summary.id, name);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(summary.name);
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmingDelete(false);
    try {
      await sessionRepo.remove(summary.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const session = body.session ?? (await sessionRepo.get(summary.id));
      if (session === undefined) {
        setError('This session no longer exists.');
        return;
      }
      setError(undefined);
      await onRestore(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreWindow = (windowIndex: number) => {
    if (body.session === undefined) {
      return;
    }
    setError(undefined);
    void onRestoreWindow(body.session, windowIndex);
  };

  return (
    <li className="rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
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
          {editing ? (
            <Input
              autoFocus
              value={draft}
              aria-label="Session name"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKey}
              onBlur={() => void commitRename()}
              className="h-8"
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="min-w-0 truncate text-left text-sm font-medium hover:underline"
                title="Rename"
                onClick={startRename}
              >
                {summary.name}
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Rename session"
                onClick={startRename}
              >
                <Pencil />
              </Button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formatSessionMeta(summary)} · saved {formatDateTime(summary.updatedAt)}
          </p>
        </div>

        {summary.kind === 'history' && <Badge variant="secondary">history</Badge>}

        <Button size="sm" onClick={() => void handleRestore()} disabled={busy || restoring}>
          <RotateCcw />
          Restore
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // Keep the rename input focused instead of handing focus back to the trigger,
              // whose blur would commit and close the edit right away.
              if (renameRequestedRef.current) {
                event.preventDefault();
                renameRequestedRef.current = false;
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                renameRequestedRef.current = true;
                startRename();
              }}
            >
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {expanded && (
        <div className="mt-3">
          {body.loading && body.session === undefined && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {body.error !== undefined && <p className="text-xs text-destructive">{body.error}</p>}
          {body.session !== undefined && (
            // Plain overflow container, not Radix's ScrollArea: its viewport is `size-full`, and a
            // percentage height against a `max-height`-only parent resolves to auto, so nothing
            // ever clipped and the tree overflowed the card instead of scrolling.
            <div className="max-h-96 overflow-y-auto">
              <div className="space-y-2 pr-3">
                {body.session.windows.map((window, index) => (
                  <WindowTree
                    // biome-ignore lint/suspicious/noArrayIndexKey: no stable window id
                    key={`window-${index}`}
                    window={window}
                    index={index}
                    onRestoreWindow={() => handleRestoreWindow(index)}
                    restoring={busy || restoring}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DeleteSessionDialog
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void handleDelete()}
      />
    </li>
  );
}
