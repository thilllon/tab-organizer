import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSqlStore, type Query, type Store } from '../src/store.js';
import type { RecordInput } from '../src/types.js';
import { b64, createTestDb, resetDb, validKeySetup } from './helpers.js';

let db: PGlite;
let query: Query;
let store: Store;

beforeAll(async () => {
  ({ db, query, store } = await createTestDb());
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetDb(db);
});

const NOW = 1_800_000_000_000;

function record(id: string, updatedAt: number, fill = 1): RecordInput {
  return { kind: 'session', id, updatedAt, deleted: false, iv: b64(12), ciphertext: b64(24, fill) };
}

describe('the SQL store on Postgres (PGlite, real migration)', () => {
  it('upserts a user by sub and keeps the id', async () => {
    const first = await store.upsertUser('sub', 'a@example.com');
    const second = await store.upsertUser('sub', 'b@example.com');
    expect(second).toEqual({ id: first.id, email: 'b@example.com', keySetup: null });
  });

  it('finds a user by a live token only', async () => {
    const user = await store.upsertUser('sub', 'a@example.com');
    await store.createToken('hash', user.id, NOW + 1000, NOW);
    expect(await store.findUserByToken('hash', NOW + 999)).toEqual(user);
    expect(await store.findUserByToken('hash', NOW + 1000)).toBeNull();
    expect(await store.findUserByToken('other', NOW)).toBeNull();
    await store.deleteToken('hash');
    expect(await store.findUserByToken('hash', NOW)).toBeNull();
  });

  it('sets the key setup only while it is null, and reads it back as JSON', async () => {
    const user = await store.upsertUser('sub', 'a@example.com');
    expect(await store.setKeySetup(user.id, validKeySetup() as never)).toBe(true);
    expect(await store.setKeySetup(user.id, validKeySetup() as never)).toBe(false);
    expect((await store.upsertUser('sub', 'a@example.com')).keySetup).toEqual(validKeySetup());
  });

  it('gives every applied write a new, larger seq from one sequence across users', async () => {
    const a = await store.upsertUser('a', 'a@example.com');
    const b = await store.upsertUser('b', 'b@example.com');
    const seqs: number[] = [];
    for (const [user, rec] of [
      [a, record('x', 1)],
      [b, record('x', 1)],
      [a, record('x', 2)],
      [a, record('y', 1)],
    ] as const) {
      const result = await store.applyRecord(user.id, rec);
      expect(result.status).toBe('applied');
      if (result.status === 'applied') {
        seqs.push(result.seq);
      }
    }
    expect([...seqs].sort((p, q) => p - q)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(4);
  });

  it('does not bump seq for a stale write', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    const applied = await store.applyRecord(user.id, record('x', 5));
    const stale = await store.applyRecord(user.id, record('x', 5, 9));
    expect(stale).toEqual({
      status: 'stale',
      current: { ...record('x', 5), seq: applied.status === 'applied' ? applied.seq : -1 },
    });
  });

  it('lets exactly one of many writers with the same updatedAt win', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.applyRecord(user.id, record('x', 10, i + 1))),
    );
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
  });

  it('ends with the newest of many writes sent at once', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    await Promise.all([3, 9, 1, 7, 5].map((t) => store.applyRecord(user.id, record('x', t, t))));
    const [stored] = await store.listRecords(user.id, 0, 10);
    expect(stored.updatedAt).toBe(9);
    expect(stored.ciphertext).toBe(b64(24, 9));
  });

  it('returns bigint columns as numbers', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    await store.applyRecord(user.id, record('x', Number.MAX_SAFE_INTEGER));
    const [stored] = await store.listRecords(user.id, 0, 10);
    expect(stored.updatedAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof stored.seq).toBe('number');
  });

  it('lists ascending by seq, after since, at most limit', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    for (const id of ['a', 'b', 'c', 'd']) {
      await store.applyRecord(user.id, record(id, 1));
    }
    const all = await store.listRecords(user.id, 0, 10);
    expect(all.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    const page = await store.listRecords(user.id, all[0].seq, 2);
    expect(page.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('deleting a user removes their tokens and records by cascade', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    await store.createToken('hash', user.id, NOW + 1000, NOW);
    await store.applyRecord(user.id, record('x', 1));
    await store.deleteUser(user.id);
    for (const table of ['users', 'auth_tokens', 'records']) {
      expect(await query(`SELECT count(*)::int AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }
  });

  it('writes nothing for a user that no longer exists', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    await store.deleteUser(user.id);
    await expect(store.applyRecord(user.id, record('x', 1))).rejects.toThrow();
    expect(await query('SELECT count(*)::int AS n FROM records')).toEqual([{ n: 0 }]);
  });

  it("takes the user's row lock, so a user's writes commit in seq order", async () => {
    // PGlite has one connection, so two writers cannot really race here: check instead that the
    // write locks the user's row before it takes a seq.
    const user = await store.upsertUser('a', 'a@example.com');
    const seen: string[] = [];
    const spying = createSqlStore(async (text, params) => {
      seen.push(text);
      return query(text, params);
    });
    await spying.applyRecord(user.id, record('x', 1));
    expect(seen[0]).toMatch(/FROM users WHERE id = \$1 FOR NO KEY UPDATE/);
  });

  it('refuses at the database what validation should have caught', async () => {
    const user = await store.upsertUser('a', 'a@example.com');
    await expect(
      store.applyRecord(user.id, { ...record('x', 1), kind: 'other' as never }),
    ).rejects.toThrow();
    await expect(store.applyRecord(user.id, record('bad id', 1))).rejects.toThrow();
  });
});

describe('applyRecord when the write does not apply', () => {
  it('reads the current row in a statement of its own, after the upsert', async () => {
    const row = {
      kind: 'session',
      id: 'x',
      updated_at: '7',
      deleted: false,
      iv: b64(12),
      ciphertext: b64(24),
      seq: '42',
    };
    const answers: Record<string, unknown>[][] = [[], [row]];
    const statements: string[] = [];
    const raced = createSqlStore(async (text) => {
      statements.push(text);
      return answers.shift() ?? [];
    });
    expect(await raced.applyRecord('u', record('x', 7))).toEqual({
      status: 'stale',
      current: { ...record('x', 7), seq: 42 },
    });
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/FOR NO KEY UPDATE/);
    expect(statements[1]).toMatch(/^SELECT /);
    await expect(raced.applyRecord('u', record('x', 7))).rejects.toThrow();
  });
});
