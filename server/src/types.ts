/** The kinds of record a client may store. Anything else is refused with 400. */
export const RECORD_KINDS = ['session', 'settings'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** What a device needs to derive the encryption key from the passphrase and check it. */
export interface KeySetup {
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
  salt: string;
  check: string;
  checkIv: string;
}

export interface User {
  id: string;
  email: string;
  keySetup: KeySetup | null;
}

/** A record as a client sends it. The server never sees what is inside `ciphertext`. */
export interface RecordInput {
  kind: RecordKind;
  id: string;
  updatedAt: number;
  deleted: boolean;
  iv: string;
  ciphertext: string;
}

/** A stored record, with the sequence number of the write that last changed it. */
export interface StoredRecord extends RecordInput {
  seq: number;
}

export type ApplyResult =
  | { status: 'applied'; seq: number }
  | { status: 'stale'; current: StoredRecord };

export interface GoogleIdentity {
  sub: string;
  email: string;
}
