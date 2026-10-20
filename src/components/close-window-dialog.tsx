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
import { formatNumber, joinSentences, t, tp } from '@/lib/i18n';

interface CloseWindowDialogProps {
  /** Window number as shown in the pane (1-based), or undefined while the dialog fades out. */
  windowNumber?: number;
  tabCount: number;
  /** True when it is the window the dashboard itself is in - closing it closes the dashboard. */
  isCurrent: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

export function CloseWindowDialog({
  windowNumber,
  tabCount,
  isCurrent,
  open,
  onOpenChange,
  onConfirm,
}: CloseWindowDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {t(
              'openCloseWindowQuestion',
              windowNumber === undefined ? '' : formatNumber(windowNumber),
            )}
          </DialogTitle>
          <DialogDescription>
            {isCurrent
              ? joinSentences(tp('openCloseWindowBody', tabCount), t('openCloseWindowIsCurrent'))
              : tp('openCloseWindowBody', tabCount)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('commonCancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('openCloseWindow')}
          </Button>
        </DialogFooter>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  );
}
