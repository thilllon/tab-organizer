/**
 * The extra lines the restore toast shows while `executeRestore` runs (spec §12 Phase 6:
 * "lazy restore 'auto' UX + progress/cancel polish"). The tab counter itself stays where it was
 * - this is the per-window line, the throughput and the lazy-restore explanation, all pure so
 * they can be tested without a DOM.
 */

import { formatNumber, t, tp } from '@/lib/i18n';

/**
 * "Window 2 of 3" - which window of the plan is being filled. `index` is 0-based, as
 * `executeRestore` reports it. A single-window restore returns undefined: "Window 1 of 1" tells
 * the user nothing the tab counter has not already said.
 */
export function formatWindowLine(index: number, count: number): string | undefined {
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 1) {
    return undefined;
  }
  const shown = Math.min(Math.max(1, Math.floor(index) + 1), Math.floor(count));
  return t('restoreWindowLine', formatNumber(shown), formatNumber(Math.floor(count)));
}

/** Below this the sample is too short for a rate that does not jump around. */
const MIN_SAMPLE_MS = 750;

/**
 * "~45 tabs/s" - measured over the whole run so far, not the last chunk, so the number settles
 * instead of flickering. Undefined until there is enough of a sample to be honest about.
 */
export function formatRate(done: number, elapsedMs: number): string | undefined {
  if (!Number.isFinite(done) || !Number.isFinite(elapsedMs)) {
    return undefined;
  }
  if (done <= 0 || elapsedMs < MIN_SAMPLE_MS) {
    return undefined;
  }
  const perSecond = done / (elapsedMs / 1000);
  // Under 10/s the integer would round away most of the signal (0.4 -> "0 tabs/s").
  const rounded = perSecond >= 10 ? Math.round(perSecond) : Math.round(perSecond * 10) / 10;
  return tp('restoreRate', rounded);
}

/** Shown while a lazy restore runs - the tabs appear immediately but stay unloaded. */
export function lazyRestoreHint(): string {
  return t('restoreLazyHint');
}

/** Shown on the result of a restore that discarded tabs. */
export function lazyRestoreSummaryHint(discarded: number): string | undefined {
  if (discarded <= 0) {
    return undefined;
  }
  return tp('restoreLazyDone', discarded);
}
