import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_HINT_MIN_BYTES,
  type StorageBreakdown,
  snapshotHint,
  storageDetailLine,
  storageSegments,
  storageTotalLine,
  summarizeStorage,
} from '@/dashboard/lib/storage-meter';
import type { SessionKind } from '@/types';

const MB = 1024 * 1024;

function entry(kind: SessionKind, bytes: number): { kind: SessionKind; bytes: number } {
  return { kind, bytes };
}

function breakdown(patch: Partial<StorageBreakdown> = {}): StorageBreakdown {
  return {
    total: 0,
    saved: 0,
    snapshots: 0,
    other: 0,
    savedCount: 0,
    snapshotCount: 0,
    ...patch,
  };
}

describe('summarizeStorage', () => {
  it('splits the index by kind and counts the entries', () => {
    const result = summarizeStorage(
      [entry('saved', 1000), entry('history', 300), entry('history', 700), entry('saved', 500)],
      4000,
    );

    expect(result).toEqual({
      total: 4000,
      saved: 1500,
      snapshots: 1000,
      other: 1500,
      savedCount: 2,
      snapshotCount: 2,
    });
  });

  it('reports zero for an empty store', () => {
    expect(summarizeStorage([], 0)).toEqual(breakdown());
  });

  it('never reports a negative remainder when the index adds up to more than the total', () => {
    // getBytesInUse() and the index's `bytes` are measured differently; the meter must not show
    // "-2 KB other" when a body compresses better than its JSON length suggests.
    const result = summarizeStorage([entry('saved', 3000)], 2000);

    expect(result.other).toBe(0);
    expect(result.total).toBe(3000);
  });

  it('treats a malformed or negative bytes field as zero', () => {
    const result = summarizeStorage(
      [entry('saved', Number.NaN), entry('history', -50), entry('saved', 10)],
      100,
    );

    expect(result.saved).toBe(10);
    expect(result.snapshots).toBe(0);
    expect(result.savedCount).toBe(2);
  });
});

describe('storageTotalLine / storageDetailLine', () => {
  it('formats the headline and the split', () => {
    const result = summarizeStorage([entry('saved', 2048), entry('history', 4096)], 8192);

    expect(storageTotalLine(result)).toBe('8.0 KB stored on this device');
    expect(storageDetailLine(result)).toBe('2.0 KB in 1 saved session · 4.0 KB in 1 snapshot');
  });

  it('pluralises both halves', () => {
    const result = summarizeStorage([], 0);

    expect(storageDetailLine(result)).toBe('0 B in 0 saved sessions · 0 B in 0 snapshots');
  });
});

describe('snapshotHint', () => {
  it('fires when snapshots are large and outweigh everything else', () => {
    expect(snapshotHint(breakdown({ total: 6 * MB, snapshots: 4 * MB, saved: 2 * MB }))).toBe(
      'Automatic snapshots use 4.0 MB — lower "Keep last N snapshots" or delete unprotected snapshots.',
    );
  });

  it('stays quiet while snapshots are small, however dominant', () => {
    expect(
      snapshotHint(breakdown({ total: SNAPSHOT_HINT_MIN_BYTES - 1, snapshots: 900_000 })),
    ).toBeUndefined();
  });

  it('stays quiet when saved sessions and other data outweigh the snapshots', () => {
    expect(
      snapshotHint(breakdown({ total: 10 * MB, snapshots: 4 * MB, saved: 3 * MB, other: 3 * MB })),
    ).toBeUndefined();
  });

  it('stays quiet for an empty store', () => {
    expect(snapshotHint(breakdown())).toBeUndefined();
  });
});

describe('storageSegments', () => {
  it('turns the breakdown into bar widths that add up to 100', () => {
    const segments = storageSegments(breakdown({ total: 1000, saved: 250, snapshots: 500 }));

    expect(segments).toEqual({ saved: 25, snapshots: 50, other: 25 });
  });

  it('gives the rounding remainder to the "other" segment', () => {
    const segments = storageSegments(breakdown({ total: 3, saved: 1, snapshots: 1 }));

    expect(segments.saved + segments.snapshots + segments.other).toBeCloseTo(100, 5);
  });

  it('is all zeroes when nothing is stored', () => {
    expect(storageSegments(breakdown())).toEqual({ saved: 0, snapshots: 0, other: 0 });
  });
});
