CREATE TABLE IF NOT EXISTS qsession_music_playlists (
  account_id TEXT PRIMARY KEY,
  playlists JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(playlists) = 'array')
);
