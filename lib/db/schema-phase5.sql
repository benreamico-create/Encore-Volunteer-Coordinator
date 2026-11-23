-- Organizer-only event communication. These are additive tables: volunteer
-- sign-up and private-link records remain unchanged.
CREATE TABLE IF NOT EXISTS messages (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_event_id_idx ON messages(event_id, id);

CREATE TABLE IF NOT EXISTS announcements (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_event_latest_idx ON announcements(event_id, id DESC);
