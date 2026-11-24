-- Tier 4: additive changes only; existing accounts and event links are preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sponsor_goal_amount double precision CHECK(sponsor_goal_amount >= 0);
CREATE TABLE IF NOT EXISTS sponsors (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, offer_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'asked' CHECK(status IN ('asked','talking','yes','declined')),
  owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  amount double precision CHECK(amount >= 0), next_step_text text NOT NULL DEFAULT '',
  next_step_due date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsors_event_idx ON sponsors(event_id);
-- Preserve legacy constraint and permit only the additional PRD source.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check CHECK(source IN ('manual','ai_plan','signup','carryover','starter','sponsor'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_type text CHECK(link_type IN ('task','map_item','role'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_id integer;
CREATE TABLE IF NOT EXISTS series_members (
  series_id integer NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('editor','viewer')), PRIMARY KEY(series_id,user_id)
);
CREATE TABLE IF NOT EXISTS series_invites (
  id serial PRIMARY KEY, series_id integer NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, role text NOT NULL CHECK(role IN ('editor','viewer')),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE IF NOT EXISTS email_log (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  volunteer_id integer REFERENCES volunteers(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK(kind IN ('confirmation','reminder')),
  status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS confirmation_once_idx ON email_log(volunteer_id) WHERE kind='confirmation';
CREATE TABLE IF NOT EXISTS reminder_sends (
  event_id integer PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, reserved_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_updates (
  series_id integer PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE, applied_at timestamptz NOT NULL DEFAULT now()
);
