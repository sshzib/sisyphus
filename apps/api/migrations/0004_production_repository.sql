DO $$ BEGIN
  CREATE TYPE credential_kind AS ENUM ('user', 'device');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE credential_role AS ENUM ('admin', 'member', 'viewer', 'device');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS policy_id text;
UPDATE evaluations SET policy_id = policy_version WHERE policy_id IS NULL;
ALTER TABLE evaluations ALTER COLUMN policy_id SET NOT NULL;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS evaluation_kind text;
UPDATE evaluations SET evaluation_kind = result::text WHERE evaluation_kind IS NULL;
ALTER TABLE evaluations ALTER COLUMN evaluation_kind SET NOT NULL;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS attempt_count integer;
UPDATE evaluations SET attempt_count = 1 WHERE attempt_count IS NULL;
ALTER TABLE evaluations ALTER COLUMN attempt_count SET NOT NULL;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS advisory_received_at timestamptz;
ALTER TABLE evaluations ALTER COLUMN score TYPE numeric(8,7);
ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_kind;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_kind
  CHECK (evaluation_kind IN (
    'pass',
    'retryable-failure',
    'terminal-failure',
    'inconclusive',
    'late'
  ));
ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_attempt_count;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_attempt_count
  CHECK (attempt_count BETWEEN 1 AND 3);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS runtime_run_id text;
UPDATE runs SET runtime_run_id = event_id WHERE runtime_run_id IS NULL;
ALTER TABLE runs ALTER COLUMN runtime_run_id SET NOT NULL;
DROP INDEX IF EXISTS runs_tenant_work_item_unique;
CREATE UNIQUE INDEX IF NOT EXISTS runs_tenant_runtime_work_item_unique
  ON runs (tenant_id, runtime_run_id, work_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS devices_tenant_id_id_unique
  ON devices (tenant_id, id);

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_device_id_fkey;
CREATE UNIQUE INDEX IF NOT EXISTS runs_tenant_id_unique ON runs (tenant_id, id);
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_tenant_device_fk;
ALTER TABLE runs ADD CONSTRAINT runs_tenant_device_fk
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, id);

ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_run_id_fkey;
ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_tenant_run_fk;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_tenant_run_fk
  FOREIGN KEY (tenant_id, run_id) REFERENCES runs (tenant_id, id);

ALTER TABLE ingest_events DROP CONSTRAINT IF EXISTS ingest_events_device_id_fkey;
CREATE UNIQUE INDEX IF NOT EXISTS ingest_events_tenant_id_unique
  ON ingest_events (tenant_id, id);
ALTER TABLE ingest_events DROP CONSTRAINT IF EXISTS ingest_events_tenant_device_fk;
ALTER TABLE ingest_events ADD CONSTRAINT ingest_events_tenant_device_fk
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, id);

ALTER TABLE ingest_outbox DROP CONSTRAINT IF EXISTS ingest_outbox_ingest_event_id_fkey;
ALTER TABLE ingest_outbox DROP CONSTRAINT IF EXISTS ingest_outbox_tenant_event_fk;
ALTER TABLE ingest_outbox ADD CONSTRAINT ingest_outbox_tenant_event_fk
  FOREIGN KEY (tenant_id, ingest_event_id) REFERENCES ingest_events (tenant_id, id);

CREATE TABLE IF NOT EXISTS api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  token_hash text NOT NULL UNIQUE,
  kind credential_kind NOT NULL,
  subject_id text,
  device_id uuid,
  role credential_role NOT NULL,
  adapter_installation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT api_credentials_token_hash_sha256
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT api_credentials_shape
    CHECK (
      (kind = 'user' AND role <> 'device' AND subject_id IS NOT NULL
        AND device_id IS NULL AND adapter_installation_id IS NULL)
      OR
      (kind = 'device' AND role = 'device' AND subject_id IS NULL
        AND device_id IS NOT NULL AND adapter_installation_id IS NOT NULL)
    ),
  CONSTRAINT api_credentials_tenant_device_fk
    FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS api_credentials_tenant_idx
  ON api_credentials (tenant_id);

CREATE TABLE IF NOT EXISTS judge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_id text NOT NULL,
  policy_version_id text NOT NULL,
  input_digest text NOT NULL,
  status text NOT NULL,
  lease_id text,
  lease_expires_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT judge_requests_input_digest_sha256
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT judge_requests_status
    CHECK (status IN ('pending', 'completed')),
  CONSTRAINT judge_requests_state
    CHECK (
      (status = 'pending' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL AND result IS NULL)
      OR
      (status = 'completed' AND lease_id IS NULL AND lease_expires_at IS NULL AND result IS NOT NULL)
    ),
  UNIQUE (tenant_id, event_id, policy_version_id)
);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM devices
    WHERE adapter_installation_id IS NULL OR btrim(adapter_installation_id) = ''
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate device credentials: every enrolled device requires adapter_installation_id.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM devices
    WHERE credential_hash !~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate device credentials: credential_hash must be a lowercase SHA-256 digest.';
  END IF;
END $$;

INSERT INTO api_credentials (
  tenant_id,
  token_hash,
  kind,
  subject_id,
  device_id,
  role,
  adapter_installation_id,
  created_at,
  revoked_at
)
SELECT
  tenant_id,
  credential_hash,
  'device'::credential_kind,
  NULL,
  id,
  'device'::credential_role,
  adapter_installation_id,
  enrolled_at,
  revoked_at
FROM devices
ON CONFLICT (token_hash) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM devices d
    LEFT JOIN api_credentials c
      ON c.tenant_id = d.tenant_id
      AND c.device_id = d.id
      AND c.token_hash = d.credential_hash
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot drop legacy device credentials: credential backfill was incomplete.';
  END IF;
END $$;

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_credential_hash_key;
DROP INDEX IF EXISTS devices_credential_hash_unique;
ALTER TABLE devices DROP COLUMN IF EXISTS credential_hash;

ALTER TABLE evaluations
  DROP CONSTRAINT IF EXISTS evaluations_evidence_digest_sha256;
ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_evidence_digest_sha256
  CHECK (evidence_digest ~ '^[a-f0-9]{64}$');

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credential_self ON api_credentials;
CREATE POLICY credential_self ON api_credentials
  FOR SELECT
  USING (token_hash = current_setting('app.credential_hash', true));

ALTER TABLE judge_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_judge_requests ON judge_requests;
CREATE POLICY tenant_judge_requests ON judge_requests
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
