import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { HostedConfiguration } from "../hosted-config";

type ConfiguredHostedMode = Extract<HostedConfiguration, { kind: "configured" }>;

export async function createSupabaseServerClient(
  configuration: ConfiguredHostedMode,
) {
  const cookieStore = await cookies();
  return createServerClient(
    configuration.supabaseUrl,
    configuration.supabasePublishableKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. The middleware refreshes
            // the session before rendering and persists any rotated tokens.
          }
        },
      },
    },
  );
}
