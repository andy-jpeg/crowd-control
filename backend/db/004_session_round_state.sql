ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS round_state text NOT NULL DEFAULT 'lobby',
  ADD COLUMN IF NOT EXISTS round_ends_at timestamptz;
