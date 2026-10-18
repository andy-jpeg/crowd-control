ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS total_rounds integer NOT NULL DEFAULT 5
  CHECK (total_rounds >= 5 AND total_rounds <= 10);
