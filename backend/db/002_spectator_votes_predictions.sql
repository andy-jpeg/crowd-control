CREATE TABLE IF NOT EXISTS spectator_votes (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  spectator_id bigint NOT NULL REFERENCES spectator_profiles(id),
  event_id text NOT NULL,
  voted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number, spectator_id)
);

CREATE TABLE IF NOT EXISTS spectator_predictions (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  spectator_id bigint NOT NULL REFERENCES spectator_profiles(id),
  prediction_type text NOT NULL CHECK (prediction_type IN ('time_bracket', 'player')),
  predicted_value text NOT NULL,
  settled boolean NOT NULL DEFAULT false,
  won boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number, spectator_id)
);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS current_round integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS spectator_profiles_username_ci_unique
  ON spectator_profiles (lower(username));
