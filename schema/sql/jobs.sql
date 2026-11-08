-- Neon job bins for Intake / Batch (run once against DATABASE_URL)
CREATE TABLE IF NOT EXISTS ticket_jobs (
  id            TEXT PRIMARY KEY,
  ticket_uuid   TEXT NOT NULL,
  bin           TEXT NOT NULL CHECK (bin IN ('asr', 'vision', 'intake', 'project')),
  state         TEXT NOT NULL DEFAULT 'queued'
                  CHECK (state IN ('queued', 'leased', 'done', 'error')),
  payload       JSONB NOT NULL DEFAULT '{}',
  lease_owner   TEXT,
  lease_until   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error         TEXT
);

CREATE INDEX IF NOT EXISTS ticket_jobs_bin_state_created
  ON ticket_jobs (bin, state, created_at);

CREATE INDEX IF NOT EXISTS ticket_jobs_ticket
  ON ticket_jobs (ticket_uuid);
