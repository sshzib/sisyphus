import postgres from "postgres";
import { z } from "zod";

const PostgresRoleNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]{0,62}$/u);

export function postgresRoleFromUrl(connectionUrl: string): string {
  const parsed = new URL(z.string().url().parse(connectionUrl));
  return PostgresRoleNameSchema.parse(decodeURIComponent(parsed.username));
}

export async function grantPostgresApplicationRole(input: {
  migrationDatabaseUrl: string;
  applicationDatabaseUrl: string;
}): Promise<void> {
  const migrationRole = postgresRoleFromUrl(input.migrationDatabaseUrl);
  const applicationRole = postgresRoleFromUrl(input.applicationDatabaseUrl);
  if (migrationRole === applicationRole) {
    throw new Error(
      "PostgreSQL migration and application URLs must use distinct roles.",
    );
  }

  const client = postgres(input.migrationDatabaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    const roles = await client<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      select rolsuper, rolbypassrls
      from pg_roles
      where rolname = ${applicationRole}
    `;
    const role = roles[0];
    if (role === undefined) {
      throw new Error(
        `PostgreSQL application role ${applicationRole} does not exist.`,
      );
    }
    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(
        "The PostgreSQL application role must not be SUPERUSER or BYPASSRLS.",
      );
    }

    await client.begin(async (transaction) => {
      await transaction`revoke all privileges on all tables in schema public from ${transaction(applicationRole)}`;
      await transaction`revoke all privileges on all sequences in schema public from ${transaction(applicationRole)}`;
      await transaction`grant usage on schema public to ${transaction(applicationRole)}`;
      await transaction`
        grant usage on type
          agent_runtime,
          evaluation_result,
          skill_disposition,
          credential_kind,
          credential_role
        to ${transaction(applicationRole)}
      `;
      await transaction`
        grant select on table tenants, api_credentials
        to ${transaction(applicationRole)}
      `;
      await transaction`
        grant select, update on table devices
        to ${transaction(applicationRole)}
      `;
      await transaction`
        grant select, insert, update on table
          runs,
          policy_bundles,
          judge_provider_configs,
          judge_requests,
          ingest_outbox,
          dashboard_projections,
          tenant_policy_states
        to ${transaction(applicationRole)}
      `;
      await transaction`
        grant select, insert on table
          evaluations,
          skill_dispositions,
          ingest_events,
          disposition_transitions
        to ${transaction(applicationRole)}
      `;
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}
