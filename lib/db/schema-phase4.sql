-- Blueprint: additive tables and event flag. Existing events, tasks, and signups
-- remain untouched when this phase is applied to an existing database.
ALTER TABLE events ADD COLUMN IF NOT EXISTS map_shared boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS maps (
  id serial PRIMARY KEY,
  event_id integer NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  source text NOT NULL CHECK(source IN ('upload','blank')),
  image_path text,
  image_name text,
  image_mime text,
  image_width integer,
  image_height integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source='blank' AND image_path IS NULL AND image_mime IS NULL) OR
    (source='upload' AND image_path IS NOT NULL AND image_mime IN ('image/png','image/jpeg'))
  )
);
CREATE TABLE IF NOT EXISTS map_items (
  id serial PRIMARY KEY,
  map_id integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('booth','station','zone','stage','entrance')),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
  x_pct double precision NOT NULL CHECK(x_pct BETWEEN 0 AND 98),
  y_pct double precision NOT NULL CHECK(y_pct BETWEEN 0 AND 98),
  w_pct double precision NOT NULL CHECK(w_pct BETWEEN 2 AND 100),
  h_pct double precision NOT NULL CHECK(h_pct BETWEEN 2 AND 100),
  vendor_name text,
  needs_text text,
  role_id integer REFERENCES roles(id) ON DELETE SET NULL,
  sort_order double precision NOT NULL DEFAULT 0,
  CHECK(x_pct + w_pct <= 100 AND y_pct + h_pct <= 100)
);
CREATE INDEX IF NOT EXISTS map_items_map_idx ON map_items(map_id,sort_order,id);

-- Upload intents bind one short-lived object path to the organizer and event
-- that requested it, so another event cannot attach an arbitrary private file.
CREATE TABLE IF NOT EXISTS map_image_uploads (
  object_path text PRIMARY KEY,
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);
