import { HardDrive, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteAllDataDialog } from '@/dashboard/components/DeleteAllDataDialog';
import { isIndexChange } from '@/dashboard/hooks/useSessionIndex';
import { errorMessage } from '@/dashboard/lib/errors';
import {
  STORAGE_METER_ID,
  snapshotHint,
  storageDetailLine,
  storageSegments,
  storageTotalLine,
  summarizeStorage,
} from '@/dashboard/lib/storage-meter';
import { sessionRepo } from '@/sessions/storage';
import type { SessionSummary } from '@/types';

export interface StorageMeterProps {
  /** The index, straight from `useSessionIndex`: the saved/snapshot split and the refresh cue. */
  summaries: SessionSummary[];
  /** "Deleted all session data." — shown in the dashboard's notice banner. */
  onNotice(message: string): void;
}

/**
 * How much of this device the extension is using (spec §4, §12 Phase 6): one `getBytesInUse()`
 * total, split into saved sessions and automatic snapshots from the index's `bytes` fields, plus
 * the hint that names the snapshots when they are what is filling the disk.
 *
 * The total is re-read whenever the index changes — every write goes through `sessionRepo`, which
 * rewrites `sessionIndex`, and `useSessionIndex` turns that `storage.onChanged` into a new
 * `summaries` array — so saving, deleting, importing or pruning all move the bar.
 */
export function StorageMeter({ summaries, onNotice }: StorageMeterProps) {
  const [bytes, setBytes] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBytes(await chrome.storage.local.getBytesInUse());
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  // Measured once on mount and again on every `sessionIndex` write — which is every save,
  // delete, import, prune and "Delete all session data", since `sessionRepo` rewrites the index
  // with each of them. (The saved/snapshot split needs no listener: `summaries` is a prop.)
  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (isIndexChange(changes, area)) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    void refresh();
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  const breakdown = summarizeStorage(summaries, bytes ?? 0);
  const segments = storageSegments(breakdown);
  const hint = snapshotHint(breakdown);

  const deleteEverything = () => {
    setConfirming(false);
    setBusy(true);
    void (async () => {
      try {
        await sessionRepo.removeAll();
        setError(undefined);
        onNotice('Deleted all session data. Your settings were kept.');
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
        await refresh();
      }
    })();
  };

  return (
    <section
      id={STORAGE_METER_ID}
      // Focus target for the "Show storage use" button on a quota notice; never in the tab order.
      tabIndex={-1}
      className="mt-3 border-t pt-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-labelledby="storage-meter-heading"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="storage-meter-heading" className="flex items-center gap-1.5 text-xs font-semibold">
          <HardDrive className="size-3.5 text-muted-foreground" />
          Storage
        </h3>
        <p className="text-xs text-muted-foreground">
          {bytes === undefined ? 'Measuring…' : storageTotalLine(breakdown)}
          {bytes === undefined ? '' : ` · ${storageDetailLine(breakdown)}`}
        </p>
        <Button
          variant="outline"
          size="xs"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
          Delete all session data
        </Button>
      </div>

      {/* Decorative: the same numbers are in the line above, spelled out. */}
      <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
        <div className="h-full bg-primary" style={{ width: `${segments.saved}%` }} />
        <div className="h-full bg-primary/50" style={{ width: `${segments.snapshots}%` }} />
        <div className="h-full bg-muted-foreground/25" style={{ width: `${segments.other}%` }} />
      </div>

      {hint !== undefined && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <DeleteAllDataDialog
        open={confirming}
        savedCount={breakdown.savedCount}
        snapshotCount={breakdown.snapshotCount}
        bytes={breakdown.total}
        onOpenChange={setConfirming}
        onConfirm={deleteEverything}
      />
    </section>
  );
}
