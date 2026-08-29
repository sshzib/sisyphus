ALTER TABLE devices ADD COLUMN IF NOT EXISTS adapter_installation_id text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS work_item_id text;
UPDATE runs
SET work_item_id = event_id
WHERE work_item_id IS NULL;
ALTER TABLE runs ALTER COLUMN work_item_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS runs_tenant_work_item_unique
  ON runs (tenant_id, work_item_id);
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS external_evaluation_id text;
UPDATE evaluations
SET external_evaluation_id = 'legacy-' || id::text
WHERE external_evaluation_id IS NULL;
ALTER TABLE evaluations ALTER COLUMN external_evaluation_id SET NOT NULL;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS cost_usd_micros integer;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS evidence_digest text;
UPDATE evaluations
SET evidence_digest = repeat('0', 64)
WHERE evidence_digest IS NULL;
ALTER TABLE evaluations ALTER COLUMN evidence_digest SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_tenant_external_unique
  ON evaluations (tenant_id, external_evaluation_id);

ALTER TABLE policy_bundles ADD COLUMN IF NOT EXISTS key_id text;
UPDATE policy_bundles
SET key_id = 'legacy-unknown'
WHERE key_id IS NULL;
ALTER TABLE policy_bundles ALTER COLUMN key_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS disposition_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  skill_version_id text NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  revision integer NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS disposition_transitions_tenant_revision_unique
  ON disposition_transitions (tenant_id, revision);
CREATE INDEX IF NOT EXISTS disposition_transitions_skill_idx
  ON disposition_transitions (tenant_id, skill_version_id);

CREATE TABLE IF NOT EXISTS dashboard_projections (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_policy_states (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  revision integer NOT NULL DEFAULT 0,
  adapter_configuration_digest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disposition_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_policy_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE disposition_transitions FORCE ROW LEVEL SECURITY;
ALTER TABLE dashboard_projections FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_policy_states FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_disposition_transitions ON disposition_transitions;
CREATE POLICY tenant_disposition_transitions ON disposition_transitions
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_dashboard_projections ON dashboard_projections;
CREATE POLICY tenant_dashboard_projections ON dashboard_projections
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_policy_states ON tenant_policy_states;
CREATE POLICY tenant_policy_states ON tenant_policy_states
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
