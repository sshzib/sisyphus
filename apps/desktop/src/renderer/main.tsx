import {
  DashboardApp,
  HostContextSchema,
  createDemoDataClient,
  type HostContext,
  type SisyphusDataClient,
} from "@sisyphus/ui";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@sisyphus/ui/styles.css";
import "./renderer.css";

function dataClient(): SisyphusDataClient {
  return {
    dataSource: { kind: "remote-api" },
    getDashboard: (query) => window.sisyphusDesktop.getDashboard(query),
    restoreSkill: (skillVersionId, input) =>
      window.sisyphusDesktop.restoreSkill(skillVersionId, input),
  };
}

function DesktopApp() {
  const demoClient = useMemo(() => createDemoDataClient(), []);
  const remoteClient = useMemo(() => dataClient(), []);
  const [client, setClient] = useState<SisyphusDataClient>(demoClient);
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
      const [nextContext, source] = await Promise.all([
        window.sisyphusDesktop.getHostContext(),
        window.sisyphusDesktop.getDataSource(),
      ]);
      if (active) {
        setHostContext(nextContext);
        setClient(source === "remote-api" ? remoteClient : demoClient);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [demoClient, remoteClient]);

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
