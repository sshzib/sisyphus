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
  const [client, setClient] = useState<SisyphusDataClient>();
  const [startupError, setStartupError] = useState<string>();
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
    let refreshTimer: number | undefined;

    const scheduleRefresh = () => {
      if (!active) return;
      refreshTimer = window.setTimeout(() => void refreshHostContext(), 2_000);
    };
    const refreshHostContext = async () => {
      try {
        const nextContext = await window.sisyphusDesktop.getHostContext();
        if (active) setHostContext(nextContext);
      } catch (error: unknown) {
        if (active) {
          setHostContext(
            HostContextSchema.parse({
              kind: "desktop",
              worker: {
                kind: "offline",
                reason:
                  error instanceof Error
                    ? error.message
                    : "The local worker status is unavailable.",
              },
              localEvidence: {
                kind: "unsupported",
                reason: "The local worker status is unavailable.",
              },
              adapterAccess: [],
            }),
          );
        }
      } finally {
        scheduleRefresh();
      }
    };
    const bootstrap = async () => {
      try {
        const [nextContext, source] = await Promise.all([
          window.sisyphusDesktop.getHostContext(),
          window.sisyphusDesktop.getDataSource(),
        ]);
        if (!active) return;
        setHostContext(nextContext);
        setClient(source === "remote-api" ? remoteClient : demoClient);
        scheduleRefresh();
      } catch (error: unknown) {
        if (active) {
          setStartupError(
            error instanceof Error
              ? error.message
              : "The desktop data source could not be selected.",
          );
        }
      }
    };
    void bootstrap();
    return () => {
      active = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [demoClient, remoteClient]);

  if (startupError !== undefined) {
    return <main className="desktop-bootstrap desktop-bootstrap--error">{startupError}</main>;
  }
  if (client === undefined) {
    return <main className="desktop-bootstrap">Connecting to Sisyphus…</main>;
  }

  return (
    <DashboardApp
      key={client.dataSource.kind}
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
