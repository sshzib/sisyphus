"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { parsePasswordUpdate } from "../../../lib/auth-input";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";

type UpdatePageState =
  | { readonly kind: "checking" }
  | { readonly kind: "ready" }
  | { readonly kind: "submitting" };

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = useState<UpdatePageState>({ kind: "checking" });
  const [feedback, setFeedback] = useState<string | undefined>();

  useEffect(() => {
    let active = true;

    async function verifyRecoverySession() {
      const result = await supabase.auth.getUser();
      if (!active) return;
      if (result.error !== null || result.data.user === null) {
        router.replace("/?authError=recovery");
        router.refresh();
        return;
      }
      setState({ kind: "ready" });
    }

    void verifyRecoverySession();
    return () => {
      active = false;
    };
  }, [router, supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);
    const form = new FormData(event.currentTarget);
    let update;
    try {
      update = parsePasswordUpdate({
        password: form.get("password"),
        passwordConfirmation: form.get("passwordConfirmation"),
      });
    } catch {
      setFeedback("Use at least 8 characters and enter the same password twice.");
      return;
    }

    setState({ kind: "submitting" });
    const { error } = await supabase.auth.updateUser({
      password: update.password,
    });
    if (error !== null) {
      setFeedback(
        error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "The password could not be updated. Request a new reset link and try again.",
      );
      setState({ kind: "ready" });
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    router.replace("/?authStatus=password-updated");
    router.refresh();
  }

  return (
    <main className="access-page">
      <section className="access-card" aria-live="polite">
        <div className="access-brand">
          <span className="sisyphus-logo access-logo" aria-hidden="true" />
          <span>Sisyphus</span>
        </div>
        <h1>Choose a new password</h1>
        <div className="access-copy">
          {state.kind === "checking" ? (
            <p>Checking your secure reset link…</p>
          ) : (
            <>
              <p>Use at least 8 characters. You will sign in again when it is saved.</p>
              {feedback === undefined ? null : (
                <p className="access-feedback" role="status">
                  {feedback}
                </p>
              )}
              <form className="access-form" onSubmit={submit}>
                <label>
                  <span>New password</span>
                  <input
                    autoComplete="new-password"
                    maxLength={128}
                    minLength={8}
                    name="password"
                    required
                    type="password"
                  />
                </label>
                <label>
                  <span>Confirm new password</span>
                  <input
                    autoComplete="new-password"
                    maxLength={128}
                    minLength={8}
                    name="passwordConfirmation"
                    required
                    type="password"
                  />
                </label>
                <button disabled={state.kind === "submitting"} type="submit">
                  {state.kind === "submitting"
                    ? "Saving password…"
                    : "Save new password"}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
