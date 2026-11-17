CREATE TABLE IF NOT EXISTS series (
  id serial PRIMARY KEY, owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, description text NOT NULL DEFAULT '', demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS series_demo_owner_idx ON series(owner_id) WHERE demo = true;
CREATE TABLE IF NOT EXISTS events (
  id serial PRIMARY KEY, series_id integer NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  previous_event_id integer REFERENCES events(id) ON DELETE SET NULL, name text NOT NULL,
  starts_at timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'America/Edmonton',
  city text NOT NULL DEFAULT '', place_text text NOT NULL DEFAULT '',
  guests_expected integer NOT NULL DEFAULT 0 CHECK(guests_expected >= 0),
  budget_amount double precision NOT NULL DEFAULT 0 CHECK(budget_amount >= 0),
  budget_currency text NOT NULL DEFAULT 'CAD', description_raw text NOT NULL,
  purpose_why text NOT NULL DEFAULT '', purpose_audience text NOT NULL DEFAULT '', purpose_takeaway text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','upcoming','done')),
  signup_slug text NOT NULL UNIQUE, signups_open boolean NOT NULL DEFAULT true,
  auto_task_from_signup boolean NOT NULL DEFAULT true, event_day_mode boolean NOT NULL DEFAULT false,
  event_day_notes text NOT NULL DEFAULT '', day_of_contact_text text NOT NULL DEFAULT '',
  plan_accepted boolean NOT NULL DEFAULT false, carried_lesson text NOT NULL DEFAULT '', carried_didnt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_series_idx ON events(series_id);
CREATE TABLE IF NOT EXISTS roles (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, instruction text NOT NULL DEFAULT '',
  slots_needed integer NOT NULL CHECK(slots_needed BETWEEN 1 AND 100), sort_order double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS roles_event_idx ON roles(event_id);
CREATE TABLE IF NOT EXISTS tasks (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_name text NOT NULL DEFAULT 'General', title text NOT NULL,
  status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  assignee_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  assignee_volunteer_id integer, role_id integer REFERENCES roles(id) ON DELETE SET NULL,
  due_date date, recurring boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','ai_plan','signup','carryover','starter')),
  source_note text NOT NULL DEFAULT '', sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (assignee_user_id IS NULL OR assignee_volunteer_id IS NULL)
);
CREATE INDEX IF NOT EXISTS tasks_event_idx ON tasks(event_id);
CREATE TABLE IF NOT EXISTS ai_usage (
  id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month text NOT NULL, call_count integer NOT NULL DEFAULT 0, UNIQUE(user_id, month)
);
