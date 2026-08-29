import type { ReactNode } from "react";
import { HostedDashboard } from "./HostedDashboard";
import { hostedPageState } from "../lib/hosted-session";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{ readonly authError?: string | string[] }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [state, query] = await Promise.all([hostedPageState(), searchParams]);
  switch (state.kind) {
    case "demo":
      return <HostedDashboard access={{ kind: "demo" }} />;
    case "authenticated":
      return (
        <HostedDashboard
          access={{ kind: "authenticated", csrfToken: state.csrfToken }}
        />
      );
    case "login":
      return <LoginPanel authenticationFailed={query.authError === "invalid"} />;
    case "misconfigured":
      return (
        <AccessPanel title="Hosted authentication is misconfigured">
          Set the server-only API URL, public origin, and session key together. The
          dashboard will not start a partial authentication setup.
        </AccessPanel>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function LoginPanel({ authenticationFailed }: { authenticationFailed: boolean }) {
  return (
    <AccessPanel title="Connect your workspace">
      <p>
        Enter a tenant access token. Sisyphus validates it with the control plane,
        then stores it in an encrypted, browser-inaccessible session cookie.
      </p>
      {authenticationFailed ? (
        <p className="access-error" role="alert">
          The token was rejected or the control plane could not validate it.
        </p>
      ) : null}
      <form action="/api/session" method="post" className="access-form">
        <label>
          <span>Tenant access token</span>
          <input
            autoComplete="off"
            maxLength={2048}
            minLength={1}
            name="token"
            pattern="[A-Za-z0-9._~-]+"
            required
            spellCheck={false}
            type="password"
          />
        </label>
        <button type="submit">Create secure session</button>
      </form>
    </AccessPanel>
  );
}

function AccessPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-brand">Sisyphus</div>
        <h1>{title}</h1>
        <div className="access-copy">{children}</div>
      </section>
    </main>
  );
}
