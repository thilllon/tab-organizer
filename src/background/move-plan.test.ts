import { describe, expect, it } from 'vitest';
import { applyMoves, isContiguous, longestIncreasingRun, planMoves } from './move-plan';

/** Deterministic pseudo-random numbers, so a failure reproduces. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffled(ids: readonly number[], random: () => number): number[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
const displaced = (plan: ReturnType<typeof planMoves>): number =>
  plan.reduce((count, batch) => count + batch.tabIds.length, 0);

describe('applyMoves', () => {
  it('places a block on consecutive indices, each tab at its final position', () => {
    expect(applyMoves([1, 2, 3, 4], [{ tabIds: [4, 3], index: 0 }])).toEqual([4, 3, 1, 2]);
    // Moving right: the index is where the tab ends up once it has been taken out.
    expect(applyMoves([1, 2, 3, 4], [{ tabIds: [1], index: 3 }])).toEqual([2, 3, 4, 1]);
  });
});

describe('longestIncreasingRun', () => {
  it('returns the positions of one longest strictly increasing subsequence', () => {
    const values = [3, 0, 1, 5, 2, 4];
    const kept = [...longestIncreasingRun(values)].sort((a, b) => a - b);
    expect(kept.map((position) => values[position])).toEqual([0, 1, 2, 4]);
  });

  it('handles the empty, sorted and reversed cases', () => {
    expect(longestIncreasingRun([]).size).toBe(0);
    expect(longestIncreasingRun([0, 1, 2, 3]).size).toBe(4);
    expect(longestIncreasingRun([3, 2, 1, 0]).size).toBe(1);
  });
});

describe('planMoves', () => {
  it('asks for nothing when the tabs are already in order', () => {
    expect(planMoves([1, 2, 3], [1, 2, 3])).toEqual([]);
    expect(planMoves([], [])).toEqual([]);
    expect(planMoves([7], [7])).toEqual([]);
  });

  it('moves one tab, not the block, when one tab is out of place', () => {
    // The first tab belongs at the end: the block move would shift all the others.
    expect(planMoves([9, 1, 2, 3, 4], [1, 2, 3, 4, 9])).toEqual([{ tabIds: [9], index: 4 }]);
    // A tab opened at the end that belongs near the front.
    expect(planMoves([1, 3, 4, 5, 2], [1, 2, 3, 4, 5])).toEqual([{ tabIds: [2], index: 1 }]);
  });

  it('joins moves onto consecutive indices into one call', () => {
    expect(planMoves([3, 4, 5, 1, 2], [1, 2, 3, 4, 5])).toEqual([{ tabIds: [1, 2], index: 0 }]);
  });

  it('falls back to the single block call when the order is thoroughly mixed', () => {
    const current = [5, 4, 3, 2, 1];
    const plan = planMoves(current, [1, 2, 3, 4, 5]);
    expect(plan).toHaveLength(1);
    expect(applyMoves(current, plan)).toEqual([1, 2, 3, 4, 5]);
  });

  it('always reaches the desired order, and never costs more than the block move', () => {
    const random = rng(20261003);
    for (let round = 0; round < 3000; round++) {
      const desired = range(Math.floor(random() * 30));
      // Mostly-sorted inputs are the common case, so mix full shuffles with a few swaps.
      const current =
        random() < 0.5
          ? shuffled(desired, random)
          : desired.reduce<number[]>(
              (order) => {
                if (order.length > 1 && random() < 0.15) {
                  const from = Math.floor(random() * order.length);
                  const [tab] = order.splice(from, 1);
                  order.splice(Math.floor(random() * (order.length + 1)), 0, tab);
                }
                return order;
              },
              [...desired],
            );
      const plan = planMoves(current, desired);
      expect(applyMoves(current, plan), `round ${round}: ${current.join(',')}`).toEqual(desired);
      // The block move displaces at most every tab in one call.
      expect(displaced(plan) + plan.length).toBeLessThanOrEqual(desired.length + 1);
    }
  });

  it('displaces the fewest tabs possible whenever it does not take the block move', () => {
    const random = rng(42);
    for (let round = 0; round < 1000; round++) {
      const desired = range(2 + Math.floor(random() * 20));
      const current = shuffled(desired, random);
      const plan = planMoves(current, desired);
      const target = new Map(desired.map((id, position) => [id, position]));
      const longest = longestIncreasingRun(current.map((id) => target.get(id) ?? -1)).size;
      if (plan.length !== 1 || plan[0].tabIds.length !== desired.length) {
        expect(displaced(plan)).toBe(desired.length - longest);
      }
    }
  });
});

describe('isContiguous', () => {
  it('accepts consecutive indices and rejects a gap', () => {
    expect(isContiguous([])).toBe(true);
    expect(isContiguous([4])).toBe(true);
    expect(isContiguous([4, 5, 6])).toBe(true);
    expect(isContiguous([4, 6, 7])).toBe(false);
  });
});
