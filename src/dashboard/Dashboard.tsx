import { Layers, Save } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SessionCard } from '@/dashboard/components/SessionCard';
import { useSessionIndex } from '@/dashboard/hooks/useSessionIndex';
import { errorMessage } from '@/dashboard/lib/errors';
import { loadSanitizeOptions } from '@/dashboard/lib/sanitize-options';
import { pickWindow } from '@/dashboard/lib/session-utils';
import { captureSession } from '@/sessions/capture';
import { executeRestore, planRestore } from '@/sessions/restore';
import { sessionRepo } from '@/sessions/storage';
import type { Session } from '@/types';

type SaveScope = 'window' | 'all';

export function Dashboard() {
  const { sessions, loading, error: indexError } = useSessionIndex();
  const [saving, setSaving] = useState<SaveScope | undefined>(undefined);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = async (scope: SaveScope) => {
    setSaving(scope);
    setError(undefined);
    setNotice(undefined);
    try {
      const session = await captureSession(scope);
      if (session.windows.length === 0) {
        setNotice('Nothing to save — this window only contains the Sessions dashboard.');
        return;
      }
      await sessionRepo.put(session);
      setNotice(`Saved “${session.name}”.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(undefined);
    }
  };

  const restore = async (session: Session): Promise<void> => {
    if (restoring) {
      // Already mid-restore: no-op rather than opening a duplicate set of windows. The header
      // Save buttons and each SessionCard's Restore button are also disabled while `restoring`
      // is true, so this is a belt-and-braces guard against a click that lands first.
      return;
    }
    setRestoring(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const [settings, sanitize] = await Promise.all([
        sessionRepo.getSettings(),
        loadSanitizeOptions(),
      ]);
      const plan = planRestore(session, {
        target: { kind: 'newWindows' },
        lazy: settings.restoreLazy,
        sanitize,
      });
      const result = await executeRestore(plan);
      setNotice(`Restored ${result.restored} of ${plan.totalTabs} tabs.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRestoring(false);
    }
  };

  const restoreWindow = async (session: Session, windowIndex: number): Promise<void> => {
    try {
      await restore(pickWindow(session, windowIndex));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-wide text-primary uppercase">Sessions</h1>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void save('window')}
            disabled={saving !== undefined || restoring}
          >
            <Save />
            Save this window
          </Button>
          <Button
            size="sm"
            onClick={() => void save('all')}
            disabled={saving !== undefined || restoring}
          >
            <Layers />
            Save all windows
          </Button>
        </div>
      </header>

      <Separator className="my-4" />

      {notice !== undefined && (
        <p role="status" aria-live="polite" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {(error ?? indexError) !== undefined && (
        <p
          role="alert"
          className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error ?? indexError}
        </p>
      )}

      <main>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((summary) => (
              <SessionCard
                key={summary.id}
                summary={summary}
                restoring={restoring}
                onRestore={restore}
                onRestoreWindow={restoreWindow}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
