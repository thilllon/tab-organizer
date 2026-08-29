import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSanitizeOptions } from '@/dashboard/lib/sanitize-options';
import {
  executeRestore,
  planRestore,
  type RestoreResult,
  type RestoreTarget,
} from '@/sessions/restore';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSettings } from '@/types';

export interface RestoreProgress {
  done: number;
  total: number;
}

export interface UseRestore {
  /**
   * Plans and executes a restore in this page. Resolves to `undefined` when a restore is
   * already running. `lazyOverride` comes from the confirm dialog's checkbox.
   */
  restore(
    session: Session,
    target: RestoreTarget,
    lazyOverride?: SessionSettings['restoreLazy'],
  ): Promise<RestoreResult | undefined>;
  progress?: RestoreProgress;
  running: boolean;
  cancel(): void;
  lastResult?: RestoreResult;
  dismiss(): void;
}

export function useRestore(): UseRestore {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | undefined>(undefined);
  const [lastResult, setLastResult] = useState<RestoreResult | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  // Spec §5: warn before leaving the page while a restore is in flight.
  useEffect(() => {
    if (!running) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [running]);

  // Abort any in-flight restore if this hook (i.e. the dashboard) unmounts.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const restore = useCallback<UseRestore['restore']>(async (session, target, lazyOverride) => {
    if (controllerRef.current !== null) {
      return undefined;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setLastResult(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      const [settings, sanitize] = await Promise.all([
        sessionRepo.getSettings(),
        loadSanitizeOptions(),
      ]);
      const plan = planRestore(session, {
        target,
        lazy: lazyOverride ?? settings.restoreLazy,
        sanitize,
      });
      setProgress({ done: 0, total: plan.totalTabs });
      const result = await executeRestore(plan, {
        onProgress: (done, total) => setProgress({ done, total }),
        signal: controller.signal,
        screen: { availWidth: window.screen.availWidth, availHeight: window.screen.availHeight },
      });
      setLastResult(result);
      return result;
    } finally {
      controllerRef.current = null;
      setProgress(undefined);
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    setLastResult(undefined);
  }, []);

  return { restore, progress, running, cancel, lastResult, dismiss };
}
