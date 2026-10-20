BEGIN;
CREATE TABLE IF NOT EXISTS qsession_music_feedback (
  actor TEXT NOT NULL,
  track_id TEXT NOT NULL,
  vote SMALLINT NOT NULL CHECK (vote IN (-1,1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(actor,track_id)
);
CREATE INDEX IF NOT EXISTS qsession_music_feedback_track ON qsession_music_feedback(track_id);
COMMIT;
