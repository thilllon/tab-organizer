import type { AssembleResult } from '@/background/assemble';
import { pluralize } from '@/dashboard/lib/format';

/** What the Open tabs view says after its Assemble button ran: a passing toast, or an error line. */
export type AssembleOutcome =
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string };

export function assembleOutcome(result: AssembleResult): AssembleOutcome {
  if (result.status === 'busy') {
    return { kind: 'notice', message: 'Still gathering — one moment.' };
  }
  if (result.status === 'nothing-to-do') {
    return { kind: 'notice', message: 'Nothing to gather — no other window holds tabs.' };
  }
  const failed = result.failures.length;
  if (failed > 0) {
    // Tabs that did not move are still in their own window, which is the thing worth saying.
    return {
      kind: 'error',
      message: `Gathered ${pluralize(result.mergedWindows, 'window')}; ${pluralize(failed, 'window')} could not be moved and ${failed === 1 ? 'was' : 'were'} left as ${failed === 1 ? 'it was' : 'they were'}.`,
    };
  }
  return {
    kind: 'notice',
    message: `Gathered ${pluralize(result.mergedWindows, 'window')} into this one.`,
  };
}
