import { LifeBuoy, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SessionSummary } from '@/types';

export interface RecoveredBannerProps {
  /** The snapshot `promoteRecoveredSnapshot()` marked `origin: 'recovered'` on the last startup. */
  summary: SessionSummary;
  restoring: boolean;
  onRestore(summary: SessionSummary): void;
  /** Remembers the id in `sessionStorage` so the banner stays gone for this tab. */
  onDismiss(summary: SessionSummary): void;
}

/**
 * Crash/restart recovery (spec §12 Phase 3): after Chrome restarts, the last snapshot of the
 * previous browser session is protected and renamed — this says so before the user goes looking
 * for windows that are gone.
 */
export function RecoveredBanner({
  summary,
  restoring,
  onRestore,
  onDismiss,
}: RecoveredBannerProps) {
  return (
    <section className="mb-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted px-3 py-2">
      <LifeBuoy className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-sm">
        Chrome was restarted. Your previous windows were saved as “{summary.name}”.
      </p>
      <Button size="sm" disabled={restoring} onClick={() => onRestore(summary)}>
        <RotateCcw />
        Restore
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onDismiss(summary)}>
        <X />
        Dismiss
      </Button>
    </section>
  );
}
