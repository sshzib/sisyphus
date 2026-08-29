DO $$
BEGIN
  CREATE TYPE runtime_profile AS ENUM ('local', 'cloud-agent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS adapter_installation_id text;
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS runtime_profile runtime_profile;

UPDATE runs AS run
SET adapter_installation_id = device.adapter_installation_id
FROM devices AS device
WHERE run.tenant_id = device.tenant_id
  AND run.device_id = device.id
  AND run.adapter_installation_id IS NULL;

-- Cursor supports both local and cloud-agent installations. Historical rows do
-- not contain enough evidence to infer that profile safely, so an operator must
-- provide an explicit mapping before this migration can make the column required.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM runs
    WHERE runtime = 'cursor'
      AND runtime_profile IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate historical Cursor runs without an explicit runtime profile mapping. Pre-create and populate runs.runtime_profile from verified installation records before applying migration 0006.';
  END IF;
END $$;

UPDATE runs
SET runtime_profile = 'local'
WHERE runtime_profile IS NULL
  AND runtime <> 'cursor';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM runs
    WHERE adapter_installation_id IS NULL
       OR btrim(adapter_installation_id) = ''
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate runs: every historical run must resolve to an adapter installation.';
  END IF;
END $$;

ALTER TABLE runs
  ALTER COLUMN adapter_installation_id SET NOT NULL;
ALTER TABLE runs
  ALTER COLUMN runtime_profile SET NOT NULL;

CREATE INDEX IF NOT EXISTS runs_tenant_installation_profile_idx
  ON runs (
    tenant_id,
    adapter_installation_id,
    runtime_profile,
    completed_at DESC
  );
