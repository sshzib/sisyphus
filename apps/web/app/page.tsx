import type { ReactNode } from "react";
import { AuthPanel } from "./AuthPanel";
import { HostedDashboard } from "./HostedDashboard";
import { hostedPageState } from "../lib/hosted-session";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{
    readonly authError?: string | string[];
    readonly authStatus?: string | string[];
  }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [state, query] = await Promise.all([hostedPageState(), searchParams]);
  switch (state.kind) {
    case "setup":
      return (
        <AccessPanel title="Connect the live control plane">
          Set the API URL, public origin, Supabase project URL, and publishable
          key. Sisyphus does not load sample records when authentication or the
          backend is disconnected.
        </AccessPanel>
      );
    case "authenticated":
      return (
        <HostedDashboard
          access={{
            kind: "authenticated",
            accountLabel: state.accountLabel,
            csrfToken: state.csrfToken,
            sessionKind: state.sessionKind,
          }}
        />
      );
    case "login":
      return (
        <LoginPanel
          developmentAdminEnabled={state.developmentAdminEnabled}
          initialMessage={
            query.authStatus === "confirmed"
              ? "Email confirmed. Sign in to continue."
              : query.authStatus === "password-updated"
                ? "Password updated. Sign in with your new password."
              : query.authError === "confirmation"
                ? "The confirmation link is invalid or expired."
                : query.authError === "recovery"
                  ? "The password-reset link is invalid or expired. Request a new one."
                : query.authError === "configuration"
                  ? "Supabase authentication is not configured."
                  : undefined
          }
        />
      );
    case "misconfigured":
      return (
        <AccessPanel title="Hosted authentication is misconfigured">
          Set the API URL, public origin, Supabase project URL, and publishable key
          together. The dashboard will not start a partial authentication setup.
        </AccessPanel>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function LoginPanel({
  developmentAdminEnabled,
  initialMessage,
}: {
  developmentAdminEnabled: boolean;
  initialMessage: string | undefined;
}) {
  return (
    <AccessPanel title="Welcome to Sisyphus">
      <AuthPanel
        developmentAdminEnabled={developmentAdminEnabled}
        initialMessage={initialMessage}
      />
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
        <div className="access-brand">
          <span className="sisyphus-logo access-logo" aria-hidden="true" />
          <span>Sisyphus</span>
        </div>
        <h1>{title}</h1>
        <div className="access-copy">{children}</div>
      </section>
    </main>
  );
}
