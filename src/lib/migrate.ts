import type { Session, SessionIndex, SessionSummary, UnreadableSession } from '@/types';
import { SESSION_SCHEMA_VERSION } from '@/types';

export class UnknownSchemaVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`Unknown session schema version: ${String(version)}`);
    this.name = 'UnknownSchemaVersionError';
  }
}

/**
 * The schema version of a body written by a *newer* Tab Organizer, or `undefined` when `err` is
 * anything else (a malformed record, or a version this build cannot place). Callers use it to
 * tell "I am too old to read this" -- which the UI can explain and the user can fix by updating
 * -- from "this record is damaged", which it cannot (spec §3).
 */
export function futureSchemaVersion(err: unknown): number | undefined {
  if (!(err instanceof UnknownSchemaVersionError)) {
    return undefined;
  }
  const { version } = err;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return undefined;
  }
  return version > SESSION_SCHEMA_VERSION ? version : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSchemaVersion(record: Record<string, unknown>): void {
  if (record.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new UnknownSchemaVersionError(record.schemaVersion);
  }
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    kind,
    name,
    origin,
    createdAt,
    updatedAt,
    windowCount,
    tabCount,
    bytes,
    protected: isProtected,
    autoProtected,
    contentHash,
    unreadable,
  } = value;

  if (
    typeof id !== 'string' ||
    (kind !== 'saved' && kind !== 'history') ||
    typeof name !== 'string' ||
    (origin !== 'manual' &&
      origin !== 'alarm' &&
      origin !== 'startup' &&
      origin !== 'recovered' &&
      origin !== 'import') ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number' ||
    typeof windowCount !== 'number' ||
    typeof tabCount !== 'number' ||
    typeof bytes !== 'number'
  ) {
    return false;
  }

  if (isProtected !== undefined && typeof isProtected !== 'boolean') {
    return false;
  }
  if (autoProtected !== undefined && typeof autoProtected !== 'boolean') {
    return false;
  }
  if (contentHash !== undefined && typeof contentHash !== 'string') {
    return false;
  }
  if (unreadable !== undefined && !isUnreadableSession(unreadable)) {
    return false;
  }

  return true;
}

/** `SessionSummary.unreadable` as `reconcile()` writes it; anything else drops the entry. */
function isUnreadableSession(value: unknown): value is UnreadableSession {
  return (
    isRecord(value) &&
    value.reason === 'unknown-schema' &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version)
  );
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
  const sessions: SessionSummary[] = record.sessions.filter((entry): entry is SessionSummary =>
    isSessionSummary(entry),
  );
  return { schemaVersion: SESSION_SCHEMA_VERSION, sessions };
}
