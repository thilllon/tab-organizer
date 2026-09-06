import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import {
  futureSchemaVersion,
  migrateIndex,
  migrateSession,
  UnknownSchemaVersionError,
} from './migrate';

const session: Session = {
  schemaVersion: 1,
  id: 'a1',
  kind: 'saved',
  name: 'Work',
  origin: 'manual',
  createdAt: 1,
  updatedAt: 2,
  windows: [
    {
      state: 'normal',
      focused: true,
      groups: [],
      tabs: [{ url: 'https://a.test', title: 'A', pinned: false, active: true }],
    },
  ],
};

describe('migrateSession', () => {
  it('is the identity for a v1 record', () => {
    const copy: unknown = JSON.parse(JSON.stringify(session));
    expect(migrateSession(copy)).toEqual(session);
  });

  it('throws TypeError for non-objects and records missing fields', () => {
    expect(() => migrateSession(null)).toThrow(TypeError);
    expect(() => migrateSession('x')).toThrow('Not a session record');
    expect(() => migrateSession({ schemaVersion: 1, id: 'a' })).toThrow('Not a session record');
  });

  it('throws UnknownSchemaVersionError for other versions', () => {
    const newer = { ...session, schemaVersion: 2 };
    expect(() => migrateSession(newer)).toThrow(UnknownSchemaVersionError);
    try {
      migrateSession(newer);
    } catch (error) {
      expect(error instanceof UnknownSchemaVersionError && error.version).toBe(2);
    }
  });
});

describe('futureSchemaVersion', () => {
  it('names the version of a body written by a newer Tab Organizer', () => {
    try {
      migrateSession({ ...session, schemaVersion: 2 });
      expect.unreachable('migrateSession must reject a v2 record');
    } catch (error) {
      // What `reconcile()` puts on the index entry, so the row can say "schema v2" (spec §3).
      expect(futureSchemaVersion(error)).toBe(2);
    }
  });

  it('is undefined for everything that is not a newer version', () => {
    expect(futureSchemaVersion(new TypeError('Not a session record'))).toBeUndefined();
    expect(futureSchemaVersion(undefined)).toBeUndefined();
    // Not a number, and an older/garbage version: damaged, not "from the future".
    expect(futureSchemaVersion(new UnknownSchemaVersionError('2'))).toBeUndefined();
    expect(futureSchemaVersion(new UnknownSchemaVersionError(undefined))).toBeUndefined();
    expect(futureSchemaVersion(new UnknownSchemaVersionError(0))).toBeUndefined();
    expect(futureSchemaVersion(new UnknownSchemaVersionError(1.5))).toBeUndefined();
  });
});

describe('migrateIndex', () => {
  it('returns an empty v1 index for undefined/null', () => {
    expect(migrateIndex(undefined)).toEqual({ schemaVersion: 1, sessions: [] });
    expect(migrateIndex(null)).toEqual({ schemaVersion: 1, sessions: [] });
  });

  it('keeps well-formed summaries and drops garbage entries', () => {
    const summary = {
      id: 'a1',
      kind: 'saved',
      name: 'Work',
      origin: 'manual',
      createdAt: 1,
      updatedAt: 2,
      windowCount: 1,
      tabCount: 1,
      bytes: 10,
    };
    expect(migrateIndex({ schemaVersion: 1, sessions: [summary, null, { id: 3 }] })).toEqual({
      schemaVersion: 1,
      sessions: [summary],
    });
  });

  it('rejects unknown versions and malformed indexes', () => {
    expect(() => migrateIndex({ schemaVersion: 9, sessions: [] })).toThrow(
      UnknownSchemaVersionError,
    );
    expect(() => migrateIndex({ schemaVersion: 1 })).toThrow('Not a session index');
    expect(() => migrateIndex(42)).toThrow('Not a session index');
  });

  it('drops entries missing required SessionSummary fields', () => {
    const validSummary = {
      id: 'a1',
      kind: 'saved' as const,
      name: 'Work',
      origin: 'manual' as const,
      createdAt: 1,
      updatedAt: 2,
      windowCount: 1,
      tabCount: 1,
      bytes: 10,
    };
    const missingName = { ...validSummary, name: undefined };
    const missingWindowCount = { ...validSummary, windowCount: undefined };
    expect(
      migrateIndex({
        schemaVersion: 1,
        sessions: [missingName, missingWindowCount, validSummary],
      }),
    ).toEqual({
      schemaVersion: 1,
      sessions: [validSummary],
    });
  });

  it('keeps a valid unreadable marker and drops an entry with a malformed one', () => {
    const base = {
      id: 'a1',
      kind: 'saved' as const,
      name: 'Work',
      origin: 'manual' as const,
      createdAt: 1,
      updatedAt: 2,
      windowCount: 0,
      tabCount: 0,
      bytes: 10,
    };
    const marked = { ...base, unreadable: { reason: 'unknown-schema', version: 2 } };
    const malformed = { ...base, id: 'a2', unreadable: { reason: 'nope' } };

    expect(migrateIndex({ schemaVersion: 1, sessions: [marked, malformed] })).toEqual({
      schemaVersion: 1,
      sessions: [marked],
    });
  });

  it('drops entries with invalid kind', () => {
    const validSummary = {
      id: 'a1',
      kind: 'saved' as const,
      name: 'Work',
      origin: 'manual' as const,
      createdAt: 1,
      updatedAt: 2,
      windowCount: 1,
      tabCount: 1,
      bytes: 10,
    };
    const invalidKind = { ...validSummary, kind: 'bogus' };
    expect(
      migrateIndex({
        schemaVersion: 1,
        sessions: [invalidKind, validSummary],
      }),
    ).toEqual({
      schemaVersion: 1,
      sessions: [validSummary],
    });
  });

  it('keeps fully valid entries with and without optional fields', () => {
    const withoutOptional = {
      id: 'a1',
      kind: 'saved' as const,
      name: 'Work',
      origin: 'manual' as const,
      createdAt: 1,
      updatedAt: 2,
      windowCount: 1,
      tabCount: 1,
      bytes: 10,
    };
    const withOptional = {
      ...withoutOptional,
      protected: true,
      contentHash: 'abc12345',
    };
    expect(
      migrateIndex({
        schemaVersion: 1,
        sessions: [withOptional, withoutOptional],
      }),
    ).toEqual({
      schemaVersion: 1,
      sessions: [withOptional, withoutOptional],
    });
  });
});
