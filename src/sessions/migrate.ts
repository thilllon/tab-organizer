import type { Session, SessionIndex, SessionSummary } from '@/types';
import { SESSION_SCHEMA_VERSION } from '@/types';

export class UnknownSchemaVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`Unknown session schema version: ${String(version)}`);
    this.name = 'UnknownSchemaVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSchemaVersion(record: Record<string, unknown>): void {
  if (record.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new UnknownSchemaVersionError(record.schemaVersion);
  }
}

/**
 * Validates a stored session record and returns it as a `Session`.
 * v1 is the current version, so this is the identity for well-formed records.
 */
export function migrateSession(record: unknown): Session {
  if (!isRecord(record)) {
    throw new TypeError('Not a session record');
  }
  assertSchemaVersion(record);
  const { id, kind, name, origin, createdAt, updatedAt, windows } = record;
  if (
    typeof id !== 'string' ||
    (kind !== 'saved' && kind !== 'history') ||
    typeof name !== 'string' ||
    typeof origin !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number' ||
    !Array.isArray(windows)
  ) {
    throw new TypeError('Not a session record');
  }
  // Fields were checked above; the remaining nested shapes are trusted (written by sessionRepo).
  return record as unknown as Session;
}

/** Validates a stored index; `undefined`/`null` (fresh install) yields an empty index. */
export function migrateIndex(record: unknown): SessionIndex {
  if (record === undefined || record === null) {
    return { schemaVersion: SESSION_SCHEMA_VERSION, sessions: [] };
  }
  if (!isRecord(record)) {
    throw new TypeError('Not a session index');
  }
  assertSchemaVersion(record);
  if (!Array.isArray(record.sessions)) {
    throw new TypeError('Not a session index');
  }
  const sessions: SessionSummary[] = record.sessions.filter(
    (entry): entry is SessionSummary =>
      isRecord(entry) && typeof entry.id === 'string' && typeof entry.updatedAt === 'number',
  );
  return { schemaVersion: SESSION_SCHEMA_VERSION, sessions };
}
