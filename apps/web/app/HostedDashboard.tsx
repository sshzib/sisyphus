"use client";

import { DashboardApp } from "@sisyphus/ui/dashboard";
import { createDemoDataClient } from "@sisyphus/ui/demo-client";
import { createSessionDataClient } from "@sisyphus/ui/session-client";
import { useMemo } from "react";

type HostedDashboardAccess =
  | { readonly kind: "demo" }
  | { readonly kind: "authenticated"; readonly csrfToken: string };

export function HostedDashboard({ access }: { access: HostedDashboardAccess }) {
  const csrfToken = access.kind === "authenticated" ? access.csrfToken : undefined;
  const client = useMemo(
    () =>
      csrfToken === undefined
        ? createDemoDataClient()
        : createSessionDataClient({ csrfToken }),
    [csrfToken],
  );
  return <DashboardApp client={client} hostContext={{ kind: "web" }} />;
}
