CREATE TABLE IF NOT EXISTS volunteers (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE, name text NOT NULL,
  email text, email_consent boolean NOT NULL DEFAULT false, ask_again boolean NOT NULL DEFAULT false,
  token text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NULL OR email_consent = true)
);
CREATE INDEX IF NOT EXISTS volunteers_event_idx ON volunteers(event_id);
CREATE INDEX IF NOT EXISTS volunteers_role_idx ON volunteers(role_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_volunteer_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_volunteer_fk FOREIGN KEY (assignee_volunteer_id) REFERENCES volunteers(id) ON DELETE SET NULL;
  END IF;
END $$;
