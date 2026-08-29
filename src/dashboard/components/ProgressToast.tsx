import { LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRestoreSummary, splitRestoreErrors } from '@/dashboard/lib/restore-summary';
import type { RestoreResult } from '@/sessions/restore';

export interface ProgressToastProps {
  progress?: { done: number; total: number };
  result?: RestoreResult;
  /** True when `result` ended because the running restore was cancelled. */
  cancelled: boolean;
  onCancel(): void;
  onDismiss(): void;
}

export function ProgressToast({
  progress,
  result,
  cancelled,
  onCancel,
  onDismiss,
}: ProgressToastProps) {
  if (progress === undefined && result === undefined) {
    return null;
  }

  const { tabErrors, structuralProblems } =
    result === undefined ? { tabErrors: [], structuralProblems: [] } : splitRestoreErrors(result);
  // M counts attempted tabs only — see the comment on formatRestoreSummary.
  const total =
    result === undefined ? 0 : result.restored + result.skipped.length + tabErrors.length;

  return (
    <output
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-4 shadow-lg"
    >
      {progress !== undefined && (
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-4 animate-spin" />
          <div className="flex-1 text-sm">
            Restoring {progress.done} of {progress.total} tabs…
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {progress === undefined && result !== undefined && (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-sm">
            <p>{formatRestoreSummary(result, total, { cancelled })}</p>
            {(result.skipped.length > 0 ||
              tabErrors.length > 0 ||
              structuralProblems.length > 0) && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                {result.skipped.map((url, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static snapshot, never reordered
                  <li key={`skipped-${i}`} className="truncate" title={url}>
                    Skipped: {url}
                  </li>
                ))}
                {tabErrors.map((entry, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static snapshot, never reordered
                  <li key={`error-${i}`} className="truncate" title={entry.message}>
                    Failed: {entry.url} — {entry.message}
                  </li>
                ))}
                {structuralProblems.map((entry, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static snapshot, never reordered
                  <li key={`structural-${i}`} className="truncate" title={entry.message}>
                    Problem: {entry.url} — {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
            <X />
          </Button>
        </div>
      )}
    </output>
  );
}
