"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (projectUrl === undefined || publishableKey === undefined) {
    throw new Error("Supabase browser authentication is not configured.");
  }
  return createBrowserClient(projectUrl, publishableKey);
}
