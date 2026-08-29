"use client";

import {
  DashboardApp,
  createDemoDataClient,
  createHttpDataClient,
  type SisyphusDataClient,
} from "@sisyphus/ui";
import { useMemo } from "react";

function dataClient(): SisyphusDataClient {
  const apiUrl = process.env.NEXT_PUBLIC_SISYPHUS_API_URL;
  const demoToken = process.env.NEXT_PUBLIC_SISYPHUS_DEMO_TOKEN;
  if (apiUrl !== undefined && demoToken !== undefined) {
    return createHttpDataClient({ baseUrl: apiUrl, token: demoToken });
  }
  return createDemoDataClient();
}

export default function DashboardPage() {
  const client = useMemo(() => dataClient(), []);
  return <DashboardApp client={client} hostContext={{ kind: "web" }} />;
}
