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

export interface CloseWindowDialogProps {
  /** Window number as shown in the pane (1-based), or undefined while the dialog fades out. */
  windowNumber?: number;
  tabCount: number;
  /** True when it is the window the dashboard itself is in — closing it closes the dashboard. */
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close window {windowNumber ?? ''}?</DialogTitle>
          <DialogDescription>
            {pluralize(tabCount, 'tab')} will be closed. Save the window first if you want it back.
            {isCurrent ? ' This is the window the Sessions dashboard is in.' : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Close window
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
