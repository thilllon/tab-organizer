import { Layers, Save } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/dashboard/components/EmptyState';
import { ProgressToast } from '@/dashboard/components/ProgressToast';
import {
  type PendingRestore,
  RestoreConfirmDialog,
} from '@/dashboard/components/RestoreConfirmDialog';
import { SessionCard } from '@/dashboard/components/SessionCard';
import { useRestore } from '@/dashboard/hooks/useRestore';
import { useSessionIndex } from '@/dashboard/hooks/useSessionIndex';
import { errorMessage } from '@/dashboard/lib/errors';
import { needsRestoreConfirm } from '@/dashboard/lib/restore-summary';
import { pickWindow } from '@/dashboard/lib/session-utils';
import { captureSession } from '@/sessions/capture';
import type { RestoreTarget } from '@/sessions/restore';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSettings } from '@/types';

type SaveScope = 'window' | 'all';

const NEW_WINDOWS: RestoreTarget = { kind: 'newWindows' };

export function Dashboard() {
  const { sessions, loading, error: indexError } = useSessionIndex();
  const { restore, progress, running, cancel, lastResult, cancelled, dismiss } = useRestore();
  const [saving, setSaving] = useState<SaveScope | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingRestore | undefined>(undefined);

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

  const runRestore = async (
    session: Session,
    target: RestoreTarget,
    lazy?: SessionSettings['restoreLazy'],
  ): Promise<void> => {
    try {
      await restore(session, target, lazy);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // `windowIndex`, when given, scopes the restore to a single window of `session`. `pickWindow`
  // runs in here (inside the try) rather than in the JSX callback, so a bad index (RangeError)
  // lands in the error banner instead of escaping into the click handler.
  const requestRestore = async (
    session: Session,
    target: RestoreTarget,
    windowIndex?: number,
  ): Promise<void> => {
    if (running) {
      // Belt-and-braces re-entrancy guard: the header Save buttons and each SessionCard's
      // Restore button are also disabled while `running` is true (via the `restoring` prop), so
      // this only matters for a click that lands first.
      setNotice('A restore is already running.');
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      const scoped = windowIndex === undefined ? session : pickWindow(session, windowIndex);
      if (needsRestoreConfirm(scoped)) {
        setPending({ session: scoped, target });
        return;
      }
      await runRestore(scoped, target);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirmRestore = (lazy: SessionSettings['restoreLazy']) => {
    if (pending === undefined) {
      return;
    }
    const { session, target } = pending;
    setPending(undefined);
    void runRestore(session, target, lazy);
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
            disabled={saving !== undefined || running}
          >
            <Save />
            Save this window
          </Button>
          <Button
            size="sm"
            onClick={() => void save('all')}
            disabled={saving !== undefined || running}
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
          <EmptyState
            onSaveWindow={() => void save('window')}
            onSaveAll={() => void save('all')}
            saving={saving !== undefined}
          />
        ) : (
          <ul className="space-y-3">
            {sessions.map((summary) => (
              <SessionCard
                key={summary.id}
                summary={summary}
                restoring={running}
                onRestore={(session) => requestRestore(session, NEW_WINDOWS)}
                onRestoreWindow={(session, windowIndex) =>
                  requestRestore(session, NEW_WINDOWS, windowIndex)
                }
              />
            ))}
          </ul>
        )}
      </main>

      <RestoreConfirmDialog
        pending={pending}
        onConfirm={confirmRestore}
        onCancel={() => setPending(undefined)}
      />
      <ProgressToast
        progress={progress}
        result={lastResult}
        cancelled={cancelled}
        onCancel={cancel}
        onDismiss={dismiss}
      />
    </div>
  );
}
