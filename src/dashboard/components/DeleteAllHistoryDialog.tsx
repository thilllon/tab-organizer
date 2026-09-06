import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { pluralize } from '@/dashboard/lib/format';

export interface DeleteAllHistoryDialogProps {
  /** How many unprotected snapshots the confirm covers. */
  count: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/**
 * Confirm for the History section's "Delete all unprotected" — `removeAllHistory` never touches
 * saved sessions or protected snapshots, and the copy says so.
 */
export function DeleteAllHistoryDialog({
  count,
  open,
  onOpenChange,
  onConfirm,
}: DeleteAllHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete unprotected snapshots?</DialogTitle>
          <DialogDescription>
            {pluralize(count, 'snapshot')} will be removed from this device. Protected snapshots and
            saved sessions are kept. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete snapshots
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
