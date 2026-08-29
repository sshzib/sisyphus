CREATE TABLE IF NOT EXISTS policy_bundle_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  device_id uuid NOT NULL,
  adapter_installation_id text NOT NULL,
  revision integer NOT NULL,
  signing_key_id text NOT NULL,
  content_digest text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT policy_bundle_issuances_content_digest_sha256
    CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT policy_bundle_issuances_validity
    CHECK (expires_at > issued_at),
  CONSTRAINT policy_bundle_issuances_tenant_device_fk
    FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, id),
  UNIQUE (tenant_id, revision)
);

CREATE INDEX IF NOT EXISTS policy_bundle_issuances_audience_revision_idx
  ON policy_bundle_issuances (
    tenant_id,
    device_id,
    adapter_installation_id,
    revision DESC
  );

ALTER TABLE policy_bundle_issuances ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_bundle_issuances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_policy_bundle_issuances
  ON policy_bundle_issuances;
CREATE POLICY tenant_policy_bundle_issuances ON policy_bundle_issuances
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
