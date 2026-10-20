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

interface CloseTabsDialogProps {
  tabCount: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/**
 * Asked before a selection of several tabs is closed. One tab closes on its button, as its own
 * row's × always has; several are worth a question, because a range or "select all tabs like
 * this" also ticks tabs the list is not showing - inside a collapsed group, or past "show more"
 * in a long window - and the count here may be the first the user hears of them.
 */
export function CloseTabsDialog({ tabCount, open, onOpenChange, onConfirm }: CloseTabsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{tp('openCloseTabsQuestion', tabCount)}</DialogTitle>
          <DialogDescription>{t('openCloseTabsBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('commonCancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('openCloseTabs')}
          </Button>
        </DialogFooter>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  );
}
