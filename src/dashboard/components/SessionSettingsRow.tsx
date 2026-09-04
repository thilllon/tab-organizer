import { SessionSettingsFields } from '@/dashboard/components/SessionSettingsFields';
import { useSessionSettings } from '@/dashboard/hooks/useSessionSettings';

/**
 * The dashboard's compact settings row: the same controls the Options page's "Sessions" card
 * shows, over its own `useSessionSettings()`. Both surfaces write through `sessionRepo`, and the
 * service worker re-arms the history alarm from `storage.onChanged` — nothing here does.
 */
export function SessionSettingsRow() {
  const { settings, loading, error, update } = useSessionSettings();

  return (
    <section aria-labelledby="session-settings-heading" className="mb-4">
      <h2 id="session-settings-heading" className="sr-only">
        Snapshot settings
      </h2>
      <div className="rounded-md border bg-muted/40 px-3 py-2">
        <SessionSettingsFields
          settings={settings}
          disabled={loading}
          idPrefix="dashboard"
          onChange={(patch) => void update(patch)}
        />
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
