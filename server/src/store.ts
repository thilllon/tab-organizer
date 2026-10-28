import type { ApplyResult, KeySetup, RecordInput, StoredRecord, User } from './types.js';

/** Runs one parameterised statement and returns its rows. Neon in production, PGlite in tests. */
export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Everything the handlers need from the database. */
export interface Store {
  /** Creates the user on first sign-in, or refreshes the email of an existing one. */
  upsertUser(googleSub: string, email: string): Promise<User>;
  /** Stores a new token hash and drops the user's expired ones. Times are ms since the epoch. */
  createToken(tokenHash: string, userId: string, expiresAt: number, now: number): Promise<void>;
  /** The user a token belongs to, or null when it is unknown or expired at `now`. */
  findUserByToken(tokenHash: string, now: number): Promise<User | null>;
  deleteToken(tokenHash: string): Promise<void>;
  /** Sets the key setup when it is still null; false when one already exists. */
  setKeySetup(userId: string, keySetup: KeySetup): Promise<boolean>;
  /** The user's records with `seq > since`, ascending, at most `limit`. */
  listRecords(userId: string, since: number, limit: number): Promise<StoredRecord[]>;
  /** Last writer wins: applies the record only when its `updatedAt` is newer than the stored one. */
  applyRecord(userId: string, record: RecordInput): Promise<ApplyResult>;
  /** Deletes the user; their tokens and records go with them (ON DELETE CASCADE). */
  deleteUser(userId: string): Promise<void>;
}

const RECORD_COLUMNS = 'kind, id, updated_at, deleted, iv, ciphertext, seq';

// A bigint column comes back as a string from Neon and as a number from PGlite.
function toNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('Database returned a non-integer where an integer was expected');
  }
  return n;
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    keySetup: (row.key_setup ?? null) as KeySetup | null,
  };
}

function toRecord(row: Record<string, unknown>): StoredRecord {
  return {
    kind: row.kind as StoredRecord['kind'],
    id: String(row.id),
    updatedAt: toNumber(row.updated_at),
    deleted: row.deleted === true,
    iv: String(row.iv),
    ciphertext: String(row.ciphertext),
    seq: toNumber(row.seq),
  };
}

// One statement, so one transaction: the upsert only overwrites an older row (the WHERE on the
// conflict branch runs under the row lock, so two writers cannot both win), and when it does not
// apply, the second half returns the row that stopped it.
const APPLY_SQL = `
WITH applied AS (
  INSERT INTO records (user_id, kind, id, updated_at, deleted, iv, ciphertext)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (user_id, kind, id) DO UPDATE SET
    updated_at = EXCLUDED.updated_at,
    deleted = EXCLUDED.deleted,
    iv = EXCLUDED.iv,
    ciphertext = EXCLUDED.ciphertext,
    seq = nextval('record_seq')
  WHERE records.updated_at < EXCLUDED.updated_at
  RETURNING seq
)
SELECT true AS applied, seq, NULL::text AS kind, NULL::text AS id, NULL::bigint AS updated_at,
  NULL::boolean AS deleted, NULL::text AS iv, NULL::text AS ciphertext
FROM applied
UNION ALL
SELECT false, r.seq, r.kind, r.id, r.updated_at, r.deleted, r.iv, r.ciphertext
FROM records r
WHERE r.user_id = $1 AND r.kind = $2 AND r.id = $3 AND NOT EXISTS (SELECT 1 FROM applied)`;

export function createSqlStore(query: Query): Store {
  return {
    async upsertUser(googleSub, email) {
      const rows = await query(
        `INSERT INTO users (google_sub, email) VALUES ($1, $2)
         ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email
         RETURNING id, email, key_setup`,
        [googleSub, email],
      );
      return toUser(rows[0]);
    },

    async createToken(tokenHash, userId, expiresAt, now) {
      await query('DELETE FROM auth_tokens WHERE user_id = $1 AND expires_at <= $2', [
        userId,
        new Date(now).toISOString(),
      ]);
      await query(
        'INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
        [tokenHash, userId, new Date(expiresAt).toISOString(), new Date(now).toISOString()],
      );
    },

    async findUserByToken(tokenHash, now) {
      const rows = await query(
        `SELECT u.id, u.email, u.key_setup FROM auth_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.expires_at > $2`,
        [tokenHash, new Date(now).toISOString()],
      );
      return rows.length > 0 ? toUser(rows[0]) : null;
    },

    async deleteToken(tokenHash) {
      await query('DELETE FROM auth_tokens WHERE token_hash = $1', [tokenHash]);
    },

    async setKeySetup(userId, keySetup) {
      const rows = await query(
        'UPDATE users SET key_setup = $2::jsonb WHERE id = $1 AND key_setup IS NULL RETURNING id',
        [userId, JSON.stringify(keySetup)],
      );
      return rows.length > 0;
    },

    async listRecords(userId, since, limit) {
      const rows = await query(
        `SELECT ${RECORD_COLUMNS} FROM records WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [userId, since, limit],
      );
      return rows.map(toRecord);
    },

    async applyRecord(userId, record) {
      const params = [
        userId,
        record.kind,
        record.id,
        record.updatedAt,
        record.deleted,
        record.iv,
        record.ciphertext,
      ];
      const rows = await query(APPLY_SQL, params);
      const row = rows[0];
      if (row?.applied === true) {
        return { status: 'applied', seq: toNumber(row.seq) };
      }
      if (row !== undefined) {
        return { status: 'stale', current: toRecord(row) };
      }
      // Under READ COMMITTED the second half reads the statement's snapshot, which can miss a row
      // that a concurrent insert committed while the upsert waited on it. Read it again.
      const again = await query(
        `SELECT ${RECORD_COLUMNS} FROM records WHERE user_id = $1 AND kind = $2 AND id = $3`,
        [userId, record.kind, record.id],
      );
      if (again.length === 0) {
        throw new Error('Record neither applied nor found');
      }
      return { status: 'stale', current: toRecord(again[0]) };
    },

    async deleteUser(userId) {
      await query('DELETE FROM users WHERE id = $1', [userId]);
    },
  };
}
