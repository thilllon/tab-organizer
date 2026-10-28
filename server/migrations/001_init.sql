-- The first schema of the sync server. The server stores ciphertext only: session names, urls and
-- titles never reach these tables in the clear.

-- One sequence for every write to `records`, so a client can ask for everything that changed
-- since the last number it saw, across all of its records at once.
CREATE SEQUENCE record_seq AS bigint;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  -- { kdf: { name, hash, iterations }, salt, check, checkIv }: what a device needs to derive the
  -- key from the passphrase and test it. Null until the first device sets it; never changed after.
  key_setup jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_tokens (
  -- sha256 of the bearer token (base64url); the token itself is never stored.
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_id ON auth_tokens (user_id);

CREATE TABLE records (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('session', 'settings')),
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Milliseconds since the epoch, set by the client: last writer wins on this value.
  updated_at bigint NOT NULL,
  deleted boolean NOT NULL,
  iv text NOT NULL,
  ciphertext text NOT NULL,
  seq bigint NOT NULL DEFAULT nextval('record_seq'),
  PRIMARY KEY (user_id, kind, id)
);

CREATE INDEX records_user_seq ON records (user_id, seq);
