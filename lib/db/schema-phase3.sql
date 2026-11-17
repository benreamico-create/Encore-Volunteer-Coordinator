CREATE TABLE IF NOT EXISTS resources (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL CHECK(kind IN ('venue','sponsor','vendor','speaker','other')),
  note text NOT NULL DEFAULT '', use_again boolean NOT NULL DEFAULT false,
  carried_from_id integer REFERENCES resources(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS resources_event_idx ON resources(event_id);
CREATE TABLE IF NOT EXISTS recaps (
  id serial PRIMARY KEY, event_id integer NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  registered integer NOT NULL DEFAULT 0 CHECK(registered>=0), attended integer NOT NULL DEFAULT 0 CHECK(attended>=0),
  what_worked text NOT NULL DEFAULT '', what_didnt text NOT NULL DEFAULT '', top_lesson text NOT NULL DEFAULT '',
  rating_overall integer NOT NULL CHECK(rating_overall BETWEEN 1 AND 5),
  rating_venue integer NOT NULL CHECK(rating_venue BETWEEN 1 AND 5),
  rating_volunteers integer NOT NULL CHECK(rating_volunteers BETWEEN 1 AND 5)
);
CREATE TABLE IF NOT EXISTS recap_actions (
  id serial PRIMARY KEY, recap_id integer NOT NULL REFERENCES recaps(id) ON DELETE CASCADE,
  text text NOT NULL, picked boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);
