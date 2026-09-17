import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatBytes, pluralize } from '@/dashboard/lib/format';

export interface DeleteAllDataDialogProps {
  open: boolean;
  savedCount: number;
  snapshotCount: number;
  /** Total bytes the meter is showing; named in the first step so the size is not a surprise. */
  bytes: number;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/**
 * Two-step confirm for `sessionRepo.removeAll()` (spec §4 "Delete all data"). Step one says what
 * goes and what stays; step two is the point of no return and is the only place the destructive
 * button appears — a single mis-click can never reach it.
 */
export function DeleteAllDataDialog({
  open,
  savedCount,
  snapshotCount,
  bytes,
  onOpenChange,
  onConfirm,
}: DeleteAllDataDialogProps) {
  const [confirming, setConfirming] = useState(false);

  // Every opening starts at step one, including one right after a cancel on step two.
  useEffect(() => {
    if (open) {
      setConfirming(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>This cannot be undone</DialogTitle>
              <DialogDescription>
                Every saved session and every automatic snapshot on this device will be deleted.
                Unless you exported a backup first, they cannot be recovered.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button variant="destructive" onClick={onConfirm}>
                Delete everything
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete all session data?</DialogTitle>
              <DialogDescription>
                {pluralize(savedCount, 'saved session')} and {pluralize(snapshotCount, 'snapshot')}{' '}
                ({formatBytes(bytes)}) will be removed from this device. Your snapshot and restore
                settings are kept, and open windows and tabs are not touched.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                Continue
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
