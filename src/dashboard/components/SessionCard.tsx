import { Ellipsis, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
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
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

export interface SessionCardProps {
  summary: SessionSummary;
  onRestore(session: Session): void;
  onRestoreWindow(session: Session, windowIndex: number): void;
}

export function SessionCard({ summary, onRestore }: SessionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

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
      const session = await sessionRepo.get(summary.id);
      if (session === undefined) {
        setError('This session no longer exists.');
        return;
      }
      setError(undefined);
      onRestore(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
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
            <button
              type="button"
              className="truncate text-left text-sm font-medium hover:underline"
              title="Rename"
              onClick={startRename}
            >
              {summary.name}
            </button>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formatSessionMeta(summary)} · saved {formatDateTime(summary.updatedAt)}
          </p>
        </div>

        {summary.kind === 'history' && <Badge variant="secondary">history</Badge>}

        <Button size="sm" onClick={() => void handleRestore()} disabled={busy}>
          <RotateCcw />
          Restore
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={startRename}>
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

      {error !== undefined && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <DeleteSessionDialog
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void handleDelete()}
      />
    </li>
  );
}
