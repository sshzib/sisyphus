CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE agent_runtime AS ENUM ('codex', 'claude-code', 'cursor', 'opencode');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE evaluation_result AS ENUM ('pass', 'retryable-failure', 'terminal-failure', 'inconclusive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE skill_disposition AS ENUM ('active', 'probation', 'quarantined', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  platform text NOT NULL,
  credential_hash text NOT NULL UNIQUE,
  public_key text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS devices_tenant_idx ON devices (tenant_id);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid REFERENCES devices(id),
  event_id text NOT NULL,
  runtime agent_runtime NOT NULL,
  runtime_version text NOT NULL,
  adapter_version text NOT NULL,
  capability_snapshot jsonb NOT NULL,
  agent_id text NOT NULL,
  project text NOT NULL,
  enforcement text NOT NULL,
  attribution text NOT NULL,
  tokens integer NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS runs_tenant_completed_idx ON runs (tenant_id, completed_at);

CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  policy_version text NOT NULL,
  evaluator_version text NOT NULL,
  result evaluation_result NOT NULL,
  score numeric(5,2),
  findings jsonb NOT NULL,
  redacted_evidence jsonb NOT NULL,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluations_tenant_run_idx ON evaluations (tenant_id, run_id);

CREATE TABLE IF NOT EXISTS skill_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  skill_version_id text NOT NULL,
  disposition skill_disposition NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  revision integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, skill_version_id, revision)
);
CREATE INDEX IF NOT EXISTS skill_dispositions_current_idx ON skill_dispositions (tenant_id, skill_version_id, changed_at);

CREATE TABLE IF NOT EXISTS policy_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  revision integer NOT NULL,
  payload jsonb NOT NULL,
  signature text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id, revision)
);

CREATE TABLE IF NOT EXISTS judge_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  provider text NOT NULL DEFAULT 'openai',
  model text NOT NULL,
  encrypted_api_key jsonb NOT NULL,
  key_encryption_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  source_record_id text NOT NULL,
  event_id text NOT NULL,
  payload_digest text NOT NULL,
  payload jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS ingest_events_device_idx ON ingest_events (tenant_id, device_id);

CREATE TABLE IF NOT EXISTS ingest_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ingest_event_id uuid NOT NULL REFERENCES ingest_events(id),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS ingest_outbox_pending_idx ON ingest_outbox (tenant_id, delivered_at, available_at);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_devices ON devices;
CREATE POLICY tenant_devices ON devices USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_runs ON runs;
CREATE POLICY tenant_runs ON runs USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_evaluations ON evaluations;
CREATE POLICY tenant_evaluations ON evaluations USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_skill_dispositions ON skill_dispositions;
CREATE POLICY tenant_skill_dispositions ON skill_dispositions USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_policy_bundles ON policy_bundles;
CREATE POLICY tenant_policy_bundles ON policy_bundles USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_judge_provider_configs ON judge_provider_configs;
CREATE POLICY tenant_judge_provider_configs ON judge_provider_configs USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_ingest_events ON ingest_events;
CREATE POLICY tenant_ingest_events ON ingest_events USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_ingest_outbox ON ingest_outbox;
CREATE POLICY tenant_ingest_outbox ON ingest_outbox USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
