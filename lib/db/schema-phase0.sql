-- Development schema. Replit Publish manages the production schema diff.
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
CREATE TABLE IF NOT EXISTS request_limits (
  key text PRIMARY KEY, count integer NOT NULL, resets_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL, call_count integer NOT NULL DEFAULT 0, UNIQUE(user_id, month)
);
