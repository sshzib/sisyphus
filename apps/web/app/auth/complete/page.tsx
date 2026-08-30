"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { safeAuthContinuation } from "../../../lib/auth-input";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";

export default function CompleteAuthenticationPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    async function complete() {
      const supabase = createSupabaseBrowserClient();
      const location = new URL(window.location.href);
      const code = location.searchParams.get("code");
      const continuation = safeAuthContinuation(location.searchParams.get("next"));
      const fragment = new URLSearchParams(location.hash.slice(1));
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");

      if (code !== null) {
        await supabase.auth.exchangeCodeForSession(code);
      } else if (accessToken !== null && refreshToken !== null) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }
      const sessionResult = await supabase.auth.getSession();
      if (!active) {
        return;
      }
      const completed =
        sessionResult.error === null && sessionResult.data.session !== null;
      router.replace(
        completed
          ? (continuation ?? "/?authStatus=confirmed")
          : continuation === "/auth/update-password"
            ? "/?authError=recovery"
            : "/?authError=confirmation",
      );
      router.refresh();
    }

    void complete();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="access-page">
      <section className="access-card" aria-live="polite">
        <div className="access-brand">
          <span className="sisyphus-logo access-logo" aria-hidden="true" />
          <span>Sisyphus</span>
        </div>
        <h1>Finishing authentication</h1>
        <div className="access-copy">
          <p>Securing your session and opening the next step…</p>
        </div>
      </section>
    </main>
  );
}
