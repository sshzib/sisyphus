"use client";

import { DashboardApp } from "@sisyphus/ui/dashboard";
import { createSessionDataClient } from "@sisyphus/ui/session-client";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/browser";

type HostedDashboardAccess = {
  readonly kind: "authenticated";
  readonly accountLabel: string | undefined;
  readonly csrfToken: string;
  readonly sessionKind: "development-admin" | "supabase";
};

export function HostedDashboard({ access }: { access: HostedDashboardAccess }) {
  const router = useRouter();
  const client = useMemo(
    () => createSessionDataClient({ csrfToken: access.csrfToken }),
    [access.csrfToken],
  );
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  async function signOut() {
    if (access.sessionKind === "development-admin") {
      await fetch("/api/auth/development-session", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-Sisyphus-CSRF": access.csrfToken },
      });
    } else {
      await supabase.auth.signOut({ scope: "local" });
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="hosted-dashboard">
      <DashboardApp
        accountLabel={access.accountLabel}
        client={client}
        hostContext={{ kind: "web" }}
        onSignOut={() => void signOut()}
      />
    </div>
  );
}
