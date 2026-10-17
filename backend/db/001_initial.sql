CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spectator_profiles (
  id bigserial PRIMARY KEY,
  auth0_subject text NOT NULL UNIQUE,
  username text NOT NULL,
  total_sessions_joined bigint NOT NULL DEFAULT 0 CHECK (total_sessions_joined >= 0),
  total_tokens_spent bigint NOT NULL DEFAULT 0 CHECK (total_tokens_spent >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id bigserial PRIMARY KEY,
  session_code text NOT NULL
    CHECK (session_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$'),
  session_token uuid NOT NULL UNIQUE,
  job_id text NOT NULL,
  place_id bigint NOT NULL CHECK (place_id >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK ((status = 'active' AND ended_at IS NULL) OR
         (status = 'ended' AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_code
  ON sessions (session_code) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS session_memberships (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  spectator_id bigint NOT NULL REFERENCES spectator_profiles(id),
  token_balance bigint NOT NULL DEFAULT 0 CHECK (token_balance >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  UNIQUE (session_id, spectator_id)
);

CREATE TABLE IF NOT EXISTS token_ledger (
  id bigserial PRIMARY KEY,
  membership_id bigint NOT NULL REFERENCES session_memberships(id),
  delta bigint NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN (
    'join_reward', 'round_reward', 'interval_reward', 'prediction_reward',
    'purchase', 'refund', 'session_reset'
  )),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_commands (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  event_type text NOT NULL,
  triggered_by text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'executed', 'completed', 'failed', 'expired')
  ),
  expires_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_commands_session_id_id
  ON event_commands (session_id, id);

CREATE TABLE IF NOT EXISTS event_locks (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  event_type text NOT NULL,
  command_id bigint NOT NULL REFERENCES event_commands(id),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, event_type)
);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  event_type text NOT NULL,
  event_id bigint,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_events_command_dedup
  ON telemetry_events (session_id, event_type, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS telemetry_events_session_time
  ON telemetry_events (session_id, occurred_at);

CREATE TABLE IF NOT EXISTS round_results (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id),
  round_number integer NOT NULL CHECK (round_number > 0),
  result jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number)
);

CREATE OR REPLACE FUNCTION update_spectator_lifetime_sessions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE spectator_profiles
  SET total_sessions_joined = total_sessions_joined + 1
  WHERE id = NEW.spectator_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS session_membership_count_lifetime_session
  ON session_memberships;
CREATE TRIGGER session_membership_count_lifetime_session
  AFTER INSERT ON session_memberships
  FOR EACH ROW EXECUTE FUNCTION update_spectator_lifetime_sessions();

CREATE OR REPLACE FUNCTION update_spectator_lifetime_spend()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE session_memberships
  SET token_balance = token_balance + NEW.delta
  WHERE id = NEW.membership_id;

  IF NEW.reason IN ('purchase', 'refund') THEN
    UPDATE spectator_profiles
    SET total_tokens_spent = total_tokens_spent - NEW.delta
    WHERE id = (
      SELECT spectator_id FROM session_memberships WHERE id = NEW.membership_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS token_ledger_lifetime_spend
  ON token_ledger;
CREATE TRIGGER token_ledger_lifetime_spend
  AFTER INSERT ON token_ledger
  FOR EACH ROW EXECUTE FUNCTION update_spectator_lifetime_spend();
