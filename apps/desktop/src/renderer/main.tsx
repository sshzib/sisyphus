import {
  DashboardApp,
  HostContextSchema,
  type HostContext,
  type SisyphusDataClient,
} from "@sisyphus/ui";
import React, {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "@sisyphus/ui/styles.css";
import "./renderer.css";

function dataClient(): SisyphusDataClient {
  return {
    dataSource: { kind: "remote-api" },
    getDashboard: (query) => window.sisyphusDesktop.getDashboard(query),
    createEngineeringTask: (input) =>
      window.sisyphusDesktop.createEngineeringTask(input),
    listSkillRegistry: () => window.sisyphusDesktop.listSkillRegistry(),
    getSkillRegistryDetail: (skillId) => window.sisyphusDesktop.getSkillRegistryDetail(skillId),
    syncSkillRegistry: () => window.sisyphusDesktop.syncSkillRegistry(),
    previewSkillRegistrySync: () => window.sisyphusDesktop.previewSkillRegistrySync(),
    createCustomSkill: (input) => window.sisyphusDesktop.createCustomSkill(input),
    resolveSkillImprovementProposal: (skillId, proposalId, input) =>
      window.sisyphusDesktop.resolveSkillImprovementProposal(skillId, proposalId, input),
    restoreSkill: (skillVersionId, input) =>
      window.sisyphusDesktop.restoreSkill(skillVersionId, input),
  };
}

function DesktopApp() {
  const remoteClient = useMemo(() => dataClient(), []);
  const [authenticationState, setAuthenticationState] = useState<
    "authenticated" | "checking" | "login-required"
  >("checking");
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
    void window.sisyphusDesktop
      .getAuthenticationState()
      .then(setAuthenticationState)
      .catch(() => setAuthenticationState("login-required"));
  }, []);

  useEffect(() => {
    if (authenticationState !== "authenticated") return;
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
        if (source === "unavailable") {
          setStartupError(
            "Connect the Sisyphus control plane. Set SISYPHUS_API_URL and SISYPHUS_DESKTOP_API_TOKEN together, then restart the desktop app.",
          );
          return;
        }
        setClient(remoteClient);
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
  }, [authenticationState, remoteClient]);

  if (authenticationState === "checking") {
    return <main className="desktop-bootstrap">Preparing secure access…</main>;
  }
  if (authenticationState === "login-required") {
    return (
      <DesktopLogin
        onAuthenticated={() => setAuthenticationState("authenticated")}
      />
    );
  }

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

function DesktopLogin({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [feedback, setFeedback] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(undefined);
    const form = new FormData(event.currentTarget);
    let authenticated = false;
    try {
      authenticated = await window.sisyphusDesktop.authenticate({
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
      });
    } catch {
      setFeedback("Desktop authentication is unavailable.");
      setPending(false);
      return;
    }
    if (!authenticated) {
      setFeedback("The username or password is incorrect.");
      setPending(false);
      return;
    }
    onAuthenticated();
  }

  return (
    <main className="desktop-login-page">
      <section className="desktop-login-card">
        <div className="desktop-login-brand">Sisyphus</div>
        <h1>Local test access</h1>
        <p>Use admin as both the username and password.</p>
        {feedback === undefined ? null : (
          <p className="desktop-login-feedback" role="status">
            {feedback}
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              defaultValue="admin"
              name="username"
              required
              type="text"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              defaultValue="admin"
              name="password"
              required
              type="password"
            />
          </label>
          <button disabled={pending} type="submit">
            {pending ? "Opening dashboard…" : "Open dashboard"}
          </button>
        </form>
      </section>
    </main>
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
