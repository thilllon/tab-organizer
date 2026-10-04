import { describe, expect, it } from 'vitest';
import { assembleOutcome } from './assemble-notice';

describe('assembleOutcome', () => {
  it('confirms how many windows were gathered', () => {
    expect(assembleOutcome({ status: 'done', mergedWindows: 1, failures: [] })).toEqual({
      kind: 'notice',
      message: 'Gathered 1 window into this one.',
    });
    expect(assembleOutcome({ status: 'done', mergedWindows: 3, failures: [] }).message).toBe(
      'Gathered 3 windows into this one.',
    );
  });

  it('reports a window that could not be moved as an error that stays up', () => {
    const outcome = assembleOutcome({
      status: 'done',
      mergedWindows: 2,
      failures: [{ windowId: 7, error: new Error('Tabs cannot be edited right now') }],
    });
    expect(outcome.kind).toBe('error');
    expect(outcome.message).toBe(
      'Gathered 2 windows; 1 window could not be moved and was left as it was.',
    );
  });

  it('says so when there was nothing to gather or a run is already under way', () => {
    expect(assembleOutcome({ status: 'nothing-to-do' }).kind).toBe('notice');
    expect(assembleOutcome({ status: 'busy' }).kind).toBe('notice');
  });
});
