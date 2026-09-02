import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DeleteSessionDialogProps {
  name: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
  /**
   * Radix's close-time focus hand-off (defaults to the trigger). Call `event.preventDefault()`
   * and focus something else when the trigger is about to unmount.
   */
  onCloseAutoFocus?(event: Event): void;
}

export function DeleteSessionDialog({
  name,
  open,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: DeleteSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete session?</DialogTitle>
          <DialogDescription>
            “{name}” will be removed from this device. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
