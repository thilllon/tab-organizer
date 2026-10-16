/**
 * Which `chrome.tabs.move` calls turn one order of a block of tabs into another. Pure: ids in,
 * calls out. Indices are relative to the block's first tab; the caller adds the offset.
 *
 * Costs measured in Chrome for Testing 153 on a 300-tab window: a tab that actually changes place
 * costs about 1.2 ms wherever the request came from, a tab asked to move to where it already is
 * costs next to nothing, and each extra call that moves something adds about as much as one more
 * tab. So the price of a plan is "tabs displaced + calls", and that is what `planMoves` minimises
 * between its two candidates.
 */

/** One `chrome.tabs.move(tabIds, { index })` call. */
export interface MoveBatch {
  tabIds: [number, ...number[]];
  index: number;
}

/** A plan together with what it costs to run. */
interface Costed {
  batches: MoveBatch[];
  /** Tabs that change place. */
  displaced: number;
}

/**
 * What Chrome does with one call: the tabs go to `index`, `index + 1`, … one after another, each
 * taken out of the strip and put back at its final position. Exported for the tests, which hold
 * every plan against it.
 */
export function applyMoves(order: readonly number[], batches: readonly MoveBatch[]): number[] {
  return batches.reduce<number[]>(
    (strip, batch) =>
      batch.tabIds.reduce((current, tabId, offset) => {
        const without = current.filter((id) => id !== tabId);
        return [
          ...without.slice(0, batch.index + offset),
          tabId,
          ...without.slice(batch.index + offset),
        ];
      }, strip),
    [...order],
  );
}

/**
 * Positions (into `values`) of one longest strictly increasing subsequence — patience sorting,
 * O(n log n). Applied to "where each tab should end up, read in the order the tabs are in now",
 * it names the largest set of tabs that are already in the right order relative to one another:
 * the ones that can stay put while the rest move around them.
 */
export function longestIncreasingRun(values: readonly number[]): Set<number> {
  // tails[k] = position of the smallest value that ends an increasing run of length k + 1.
  const tails: number[] = [];
  const previous: number[] = new Array(values.length).fill(-1);
  values.forEach((value, position) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[position] = low > 0 ? tails[low - 1] : -1;
    tails[low] = position;
  });

  const kept = new Set<number>();
  for (let at = tails.length > 0 ? tails[tails.length - 1] : -1; at !== -1; at = previous[at]) {
    kept.add(at);
  }
  return kept;
}

/** Consecutive single moves onto consecutive indices are, to Chrome, one call. */
function coalesce(moves: readonly { tabId: number; index: number }[]): MoveBatch[] {
  return moves.reduce<MoveBatch[]>((batches, move) => {
    const last = batches.at(-1);
    if (last !== undefined && move.index === last.index + last.tabIds.length) {
      last.tabIds.push(move.tabId);
      return batches;
    }
    batches.push({ tabIds: [move.tabId], index: move.index });
    return batches;
  }, []);
}

/**
 * The fewest tabs displaced: everything in the longest already-ordered run stays, and each other
 * tab is put right after the tab that precedes it in `desired`. Best when a few tabs are out of
 * place — one tab that belongs at the far end is one move here, where the block move below would
 * shift every tab in between.
 */
function fewestDisplaced(current: readonly number[], desired: readonly number[]): Costed {
  const target = new Map(desired.map((tabId, position) => [tabId, position]));
  const keptPositions = longestIncreasingRun(current.map((tabId) => target.get(tabId) ?? -1));
  const kept = new Set(current.filter((_, position) => keptPositions.has(position)));

  const strip = [...current];
  const moves: { tabId: number; index: number }[] = [];
  desired.forEach((tabId, position) => {
    if (kept.has(tabId)) {
      return;
    }
    strip.splice(strip.indexOf(tabId), 1);
    const index = position === 0 ? 0 : strip.indexOf(desired[position - 1]) + 1;
    strip.splice(index, 0, tabId);
    moves.push({ tabId, index });
  });
  return { batches: coalesce(moves), displaced: moves.length };
}

/**
 * The whole block in one call, as the sorter always did. Chrome leaves a tab alone when it is
 * already where the call wants it, so the cost is the tabs that are *not* — counted here by
 * replaying the call. Best when the order is thoroughly shuffled: one call, however many tabs.
 */
function wholeBlock(current: readonly number[], desired: readonly number[]): Costed {
  const [first, ...rest] = desired;
  const strip = [...current];
  let displaced = 0;
  desired.forEach((tabId, position) => {
    if (strip[position] === tabId) {
      return;
    }
    strip.splice(strip.indexOf(tabId), 1);
    strip.splice(position, 0, tabId);
    displaced += 1;
  });
  return { batches: [{ tabIds: [first, ...rest], index: 0 }], displaced };
}

function cost(plan: Costed): number {
  return plan.displaced + plan.batches.length;
}

/**
 * The cheapest set of calls that reorders `current` into `desired` (the same ids, both in strip
 * order). Nothing at all when the order is already right.
 */
export function planMoves(current: readonly number[], desired: readonly number[]): MoveBatch[] {
  if (desired.length === 0 || desired.every((tabId, position) => current[position] === tabId)) {
    return [];
  }
  const minimal = fewestDisplaced(current, desired);
  const block = wholeBlock(current, desired);
  return cost(minimal) <= cost(block) ? minimal.batches : block.batches;
}

/** Whether the tabs sit on consecutive strip indices — what a relative plan takes for granted. */
export function isContiguous(indices: readonly number[]): boolean {
  return indices.every((index, position) => position === 0 || index === indices[position - 1] + 1);
}
