import { SessionSettingsFields } from '@/dashboard/components/SessionSettingsFields';
import { StorageMeter } from '@/dashboard/components/StorageMeter';
import { useSessionSettings } from '@/dashboard/hooks/useSessionSettings';
import type { SessionSummary } from '@/types';

export interface SessionSettingsRowProps {
  /** The index, for the storage meter's saved-vs-snapshot split. */
  summaries: SessionSummary[];
  /** "Deleted all session data." — the dashboard's notice banner. */
  onNotice(message: string): void;
}

/**
 * The dashboard's compact settings row: the same controls the Options page's "Sessions" card
 * shows, over its own `useSessionSettings()`, plus the storage meter (spec §12 Phase 6) that only
 * exists here. Both surfaces write through `sessionRepo`, and the service worker re-arms the
 * history alarm from `storage.onChanged` — nothing here does.
 */
export function SessionSettingsRow({ summaries, onNotice }: SessionSettingsRowProps) {
  const { settings, loading, error, update } = useSessionSettings();

  return (
    <section aria-labelledby="session-settings-heading" className="mb-4">
      <h2 id="session-settings-heading" className="sr-only">
        Snapshot settings and storage
      </h2>
      <div className="rounded-md border bg-muted/40 px-3 py-2">
        <SessionSettingsFields
          settings={settings}
          disabled={loading}
          idPrefix="dashboard"
          onChange={(patch) => void update(patch)}
        />
        <StorageMeter summaries={summaries} onNotice={onNotice} />
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
