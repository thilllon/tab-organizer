import type { AssembleResult } from '@/lib/assemble-tabs';
import { t, tp } from '@/lib/i18n';

/** What the Open tabs view says after its Assemble button ran: a passing toast, or an error line. */
type AssembleOutcome = { kind: 'notice'; message: string } | { kind: 'error'; message: string };

export function assembleOutcome(result: AssembleResult): AssembleOutcome {
  if (result.status === 'busy') {
    return { kind: 'notice', message: t('openAssembleBusy') };
  }
  if (result.status === 'nothing-to-do') {
    return { kind: 'notice', message: t('openAssembleNothing') };
  }
  const failed = result.failures.length;
  if (failed > 0) {
    // Tabs that did not move are still in their own window, which is the thing worth saying.
    return {
      kind: 'error',
      message: tp('openAssemblePartial', failed, tp('windowCount', result.mergedWindows)),
    };
  }
  return {
    kind: 'notice',
    message: tp('openAssembleDone', result.mergedWindows),
  };
}
