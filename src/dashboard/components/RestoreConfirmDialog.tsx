import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { countTabs } from '@/dashboard/lib/restore-summary';
import type { RestoreTarget } from '@/sessions/restore';
import type { Session, SessionSettings } from '@/types';

export interface PendingRestore {
  session: Session;
  target: RestoreTarget;
}

export interface RestoreConfirmDialogProps {
  pending?: PendingRestore;
  onConfirm(lazy: SessionSettings['restoreLazy']): void;
  onCancel(): void;
}

export function RestoreConfirmDialog({ pending, onConfirm, onCancel }: RestoreConfirmDialogProps) {
  const [lazy, setLazy] = useState(true);
  const tabCount = pending === undefined ? 0 : countTabs(pending.session);

  return (
    <Dialog
      open={pending !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore {tabCount} tabs?</DialogTitle>
          <DialogDescription>
            {pending?.session.name ?? ''} will open {pending?.session.windows.length ?? 0}{' '}
            {pending !== undefined && pending.session.windows.length === 1 ? 'window' : 'windows'}.
            Large restores can take a while and use a lot of memory.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <input
            id="restore-lazy"
            type="checkbox"
            className="size-4"
            checked={lazy}
            onChange={(event) => setLazy(event.target.checked)}
          />
          <Label htmlFor="restore-lazy">
            Load tabs lazily (recommended — tabs load when clicked)
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(lazy ? 'always' : 'never')}>Restore</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
