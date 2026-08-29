import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { z } from "zod";

const migrationsFolder = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);
export const latestMigrationTimestamp = 1_788_005_000_000;

export async function migratePostgres(connectionUrl: string): Promise<void> {
  const client = postgres(z.string().url().parse(connectionUrl), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))
) {
  const environment = z
    .object({ SISYPHUS_MIGRATION_DATABASE_URL: z.string().url() })
    .parse(process.env);
  await migratePostgres(environment.SISYPHUS_MIGRATION_DATABASE_URL);
}
