import {
  DashboardApp,
  HostContextSchema,
  createDemoDataClient,
  createHttpDataClient,
  type HostContext,
  type SisyphusDataClient,
} from "@sisyphus/ui";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@sisyphus/ui/styles.css";
import "./renderer.css";

function dataClient(): SisyphusDataClient {
  const apiUrl = import.meta.env.VITE_SISYPHUS_API_URL;
  const demoToken = import.meta.env.VITE_SISYPHUS_DEMO_TOKEN;
  if (typeof apiUrl === "string" && typeof demoToken === "string") {
    return createHttpDataClient({ baseUrl: apiUrl, token: demoToken });
  }
  return createDemoDataClient();
}

function DesktopApp() {
  const client = useMemo(() => dataClient(), []);
  const [hostContext, setHostContext] = useState<HostContext>(() =>
    HostContextSchema.parse({
      kind: "desktop",
      worker: { kind: "offline", reason: "Connecting to local worker." },
      localEvidence: { kind: "unsupported", reason: "Connecting to local worker." },
      adapterAccess: [],
    }),
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const nextContext = await window.sisyphusDesktop.getHostContext();
      if (active) setHostContext(nextContext);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <DashboardApp
      client={client}
      hostContext={hostContext}
      readLocalEvidence={(eventId) => window.sisyphusDesktop.getLocalEvidence(eventId)}
    />
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Desktop renderer root is missing.");
}
createRoot(container).render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>,
);
