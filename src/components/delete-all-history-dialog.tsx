import { DialogCloseButton } from '@/components/dialog-close-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t, tp } from '@/lib/i18n';

interface DeleteAllHistoryDialogProps {
  /** How many unprotected snapshots the confirm covers. */
  count: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/**
 * Confirm for the storage meter's "Delete all unprotected" - `removeAllHistory` never touches
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
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('storageDeleteHistoryTitle')}</DialogTitle>
          <DialogDescription>{tp('storageDeleteHistoryBody', count)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('commonCancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('storageDeleteHistoryConfirm')}
          </Button>
        </DialogFooter>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  );
}
