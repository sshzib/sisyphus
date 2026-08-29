import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

const environment = z
  .object({ SISYPHUS_DATABASE_URL: z.string().url() })
  .parse(process.env);
const client = postgres(environment.SISYPHUS_DATABASE_URL, {
  max: 1,
  prepare: false,
});

try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
  });
} finally {
  await client.end({ timeout: 5 });
}
import { fileURLToPath } from "node:url";
