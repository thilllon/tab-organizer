import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { migrateIndex, migrateSession, UnknownSchemaVersionError } from './migrate';

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
