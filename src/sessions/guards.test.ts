import { describe, expect, it } from 'vitest';
import type { ExportBundle, Session, TabSnapshot, WindowSnapshot } from '@/types';
import {
  isExportBundle,
  isGroupSnapshot,
  isRecord,
  isSession,
  isTabSnapshot,
  isWindowSnapshot,
} from './guards';

const tab: TabSnapshot = { url: 'https://a.test', title: 'A', pinned: false, active: true };

const window: WindowSnapshot = {
  state: 'normal',
  focused: true,
  bounds: { left: 0, top: 0, width: 800, height: 600 },
  groups: [{ title: 'Dev', color: 'blue', collapsed: false }],
  tabs: [
    { url: 'https://p.test', title: 'P', pinned: true, active: false },
    tab,
    { url: 'https://b.test', title: 'B', pinned: false, active: false, groupIndex: 0 },
  ],
};

const session: Session = {
  schemaVersion: 1,
  id: 'a1',
  kind: 'saved',
  name: 'Work',
  origin: 'manual',
  createdAt: 1,
  updatedAt: 2,
  windows: [window],
};

const bundle: ExportBundle = {
  app: 'tab-organizer',
  schemaVersion: 1,
  exportedAt: 3,
  sessions: [session],
};

/** A JSON clone with one field replaced (or removed when `value` is `undefined`). */
function withField(base: object, field: string, value: unknown): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...base };
  if (value === undefined) {
    delete copy[field];
  } else {
    copy[field] = value;
  }
  return copy;
}

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('isTabSnapshot', () => {
  it('accepts a valid tab, with or without groupIndex, and tolerates extra fields', () => {
    expect(isTabSnapshot(tab)).toBe(true);
    expect(isTabSnapshot({ ...tab, groupIndex: 2 })).toBe(true);
    expect(isTabSnapshot({ ...tab, favIconUrl: 'x', id: 12 })).toBe(true);
  });

  it('rejects each missing or mistyped required field', () => {
    for (const field of ['url', 'title', 'pinned', 'active']) {
      expect(isTabSnapshot(withField(tab, field, undefined))).toBe(false);
      expect(isTabSnapshot(withField(tab, field, 42))).toBe(false);
    }
    expect(isTabSnapshot(null)).toBe(false);
    expect(isTabSnapshot('https://a.test')).toBe(false);
  });

  it('rejects a groupIndex that is negative, fractional, non-numeric or on a pinned tab', () => {
    expect(isTabSnapshot({ ...tab, groupIndex: -1 })).toBe(false);
    expect(isTabSnapshot({ ...tab, groupIndex: 0.5 })).toBe(false);
    expect(isTabSnapshot({ ...tab, groupIndex: '0' })).toBe(false);
    expect(isTabSnapshot({ ...tab, pinned: true, groupIndex: 0 })).toBe(false);
  });
});

describe('isGroupSnapshot', () => {
  it('accepts every Chrome colour', () => {
    for (const color of [
      'blue',
      'cyan',
      'green',
      'grey',
      'orange',
      'pink',
      'purple',
      'red',
      'yellow',
    ]) {
      expect(isGroupSnapshot({ title: '', color, collapsed: true })).toBe(true);
    }
  });

  it('rejects unknown colours and missing fields', () => {
    expect(isGroupSnapshot({ title: 'x', color: 'gray', collapsed: false })).toBe(false);
    expect(isGroupSnapshot({ title: 'x', collapsed: false })).toBe(false);
    expect(isGroupSnapshot({ color: 'blue', collapsed: false })).toBe(false);
    expect(isGroupSnapshot({ title: 'x', color: 'blue' })).toBe(false);
    expect(isGroupSnapshot({ title: 'x', color: 'blue', collapsed: 'no' })).toBe(false);
  });
});

describe('isWindowSnapshot', () => {
  it('accepts a valid window with or without bounds', () => {
    expect(isWindowSnapshot(window)).toBe(true);
    expect(isWindowSnapshot(withField(window, 'bounds', undefined))).toBe(true);
    expect(isWindowSnapshot({ ...window, tabs: [], groups: [] })).toBe(true);
  });

  it('rejects bad state, focused, bounds, groups and tabs', () => {
    expect(isWindowSnapshot({ ...window, state: 'popup' })).toBe(false);
    expect(isWindowSnapshot({ ...window, focused: 'yes' })).toBe(false);
    expect(isWindowSnapshot({ ...window, bounds: { left: 0, top: 0 } })).toBe(false);
    expect(
      isWindowSnapshot({ ...window, bounds: { left: 0, top: 0, width: 'w', height: 1 } }),
    ).toBe(false);
    expect(isWindowSnapshot({ ...window, groups: [{ title: 'x' }] })).toBe(false);
    expect(isWindowSnapshot({ ...window, groups: 'none' })).toBe(false);
    expect(isWindowSnapshot({ ...window, tabs: [tab, { url: 1 }] })).toBe(false);
    expect(isWindowSnapshot(withField(window, 'tabs', undefined))).toBe(false);
  });

  it('rejects a groupIndex outside groups and more than one active tab', () => {
    expect(isWindowSnapshot({ ...window, tabs: [{ ...tab, groupIndex: 1 }] })).toBe(false);
    expect(isWindowSnapshot({ ...window, groups: [], tabs: [{ ...tab, groupIndex: 0 }] })).toBe(
      false,
    );
    expect(isWindowSnapshot({ ...window, tabs: [tab, { ...tab, url: 'https://c.test' }] })).toBe(
      false,
    );
  });
});

describe('isSession', () => {
  it('accepts a valid session, optional fields and extra fields', () => {
    expect(isSession(session)).toBe(true);
    expect(isSession({ ...session, protected: true, contentHash: 'abcd1234' })).toBe(true);
    expect(isSession({ ...session, kind: 'history', origin: 'alarm', extra: 'ignored' })).toBe(
      true,
    );
    expect(isSession({ ...session, windows: [] })).toBe(true);
  });

  it('rejects each missing required field', () => {
    for (const field of [
      'schemaVersion',
      'id',
      'kind',
      'name',
      'origin',
      'createdAt',
      'updatedAt',
      'windows',
    ]) {
      expect(isSession(withField(session, field, undefined))).toBe(false);
    }
  });

  it('rejects wrong schema version, enums, timestamps and optional field types', () => {
    expect(isSession({ ...session, schemaVersion: 2 })).toBe(false);
    expect(isSession({ ...session, schemaVersion: '1' })).toBe(false);
    expect(isSession({ ...session, kind: 'bogus' })).toBe(false);
    expect(isSession({ ...session, origin: 'unknown' })).toBe(false);
    expect(isSession({ ...session, createdAt: '1' })).toBe(false);
    expect(isSession({ ...session, updatedAt: Number.NaN })).toBe(false);
    expect(isSession({ ...session, protected: 'yes' })).toBe(false);
    expect(isSession({ ...session, contentHash: 42 })).toBe(false);
    expect(isSession({ ...session, windows: [window, { state: 'normal' }] })).toBe(false);
    expect(isSession({ ...session, windows: {} })).toBe(false);
    expect(isSession([session])).toBe(false);
  });
});

describe('isExportBundle', () => {
  it('accepts a valid bundle, including an empty one', () => {
    expect(isExportBundle(bundle)).toBe(true);
    expect(isExportBundle({ ...bundle, sessions: [] })).toBe(true);
  });

  it('rejects the wrong app, version, exportedAt or an invalid session', () => {
    expect(isExportBundle({ ...bundle, app: 'session-buddy' })).toBe(false);
    expect(isExportBundle({ ...bundle, schemaVersion: 2 })).toBe(false);
    expect(isExportBundle(withField(bundle, 'exportedAt', undefined))).toBe(false);
    expect(isExportBundle({ ...bundle, sessions: [session, { id: 'x' }] })).toBe(false);
    expect(isExportBundle({ ...bundle, sessions: session })).toBe(false);
    expect(isExportBundle(session)).toBe(false);
  });
});
