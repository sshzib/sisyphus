"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import {
  parseAuthEmail,
  parseEmailPassword,
  parseSignUpCredentials,
} from "../lib/auth-input";
import { createSupabaseBrowserClient } from "../lib/supabase/browser";

type AuthMode = "local-admin" | "recover" | "sign-in" | "sign-up";

export function AuthPanel({
  developmentAdminEnabled,
  initialMessage,
}: {
  developmentAdminEnabled: boolean;
  initialMessage: string | undefined;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<AuthMode>(
    developmentAdminEnabled ? "local-admin" : "sign-in",
  );
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>(initialMessage);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(undefined);
    const form = new FormData(event.currentTarget);

    if (mode === "local-admin") {
      const response = await fetch("/api/auth/development-session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        setFeedback("The username or password is incorrect.");
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
      return;
    }

    if (mode === "recover") {
      let email: string;
      try {
        email = parseAuthEmail(form.get("email"));
      } catch {
        setFeedback("Enter a valid email address.");
        setPending(false);
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/complete?next=${encodeURIComponent("/auth/update-password")}`,
      });
      setFeedback(
        error?.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "If a Sisyphus account exists for that email, a reset link is on its way.",
      );
      setPending(false);
      return;
    }

    if (mode === "sign-in") {
      let credentials;
      try {
        credentials = parseEmailPassword({
          email: form.get("email"),
          password: form.get("password"),
        });
      } catch {
        setFeedback("Enter a valid email and a password of at least 8 characters.");
        setPending(false);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword(credentials);
      if (error !== null) {
        setFeedback("The email or password is incorrect.");
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
      return;
    }

    let credentials;
    try {
      credentials = parseSignUpCredentials({
        email: form.get("email"),
        name: form.get("name"),
        password: form.get("password"),
      });
    } catch {
      setFeedback(
        "Enter your name, a valid email, and a password of at least 8 characters.",
      );
      setPending(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: {
        data: { name: credentials.name },
        emailRedirectTo: `${window.location.origin}/auth/complete`,
      },
    });
    if (error !== null) {
      setFeedback(
        error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "The account could not be created. Check the details and try again.",
      );
      setPending(false);
      return;
    }
    if (data.session !== null) {
      router.replace("/");
      router.refresh();
      return;
    }
    setFeedback("Check your inbox to confirm the account, then return to sign in.");
    setPending(false);
  }

  return (
    <>
      <p>
        {mode === "local-admin"
          ? "Local testing is enabled. Use admin as both the username and password to open the live dashboard."
          : mode === "recover"
          ? "Enter your account email and Sisyphus will send a secure password-reset link."
          : "Sign in with your Sisyphus user account. New accounts must confirm their email before the live dashboard opens."}
      </p>
      <div
        className={
          developmentAdminEnabled
            ? "auth-mode-switch has-local-admin"
            : "auth-mode-switch"
        }
        aria-label="Authentication mode"
      >
        {developmentAdminEnabled ? (
          <button
            aria-pressed={mode === "local-admin"}
            className={mode === "local-admin" ? "is-active" : undefined}
            onClick={() => {
              setMode("local-admin");
              setFeedback(undefined);
            }}
            type="button"
          >
            Test admin
          </button>
        ) : null}
        <button
          aria-pressed={mode === "sign-in"}
          className={mode === "sign-in" ? "is-active" : undefined}
          onClick={() => {
            setMode("sign-in");
            setFeedback(undefined);
          }}
          type="button"
        >
          Sign in
        </button>
        <button
          aria-pressed={mode === "sign-up"}
          className={mode === "sign-up" ? "is-active" : undefined}
          onClick={() => {
            setMode("sign-up");
            setFeedback(undefined);
          }}
          type="button"
        >
          Create account
        </button>
      </div>
      {feedback === undefined ? null : (
        <p className="access-feedback" role="status">
          {feedback}
        </p>
      )}
      <form className="access-form" onSubmit={submit}>
        {mode === "sign-up" ? (
          <label>
            <span>Name</span>
            <input
              autoComplete="name"
              maxLength={80}
              name="name"
              required
              type="text"
            />
          </label>
        ) : null}
        {mode === "local-admin" ? (
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              defaultValue="admin"
              maxLength={128}
              name="username"
              required
              type="text"
            />
          </label>
        ) : (
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              maxLength={320}
              name="email"
              required
              type="email"
            />
          </label>
        )}
        {mode === "recover" ? null : (
          <label>
            <span>Password</span>
            <input
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
              defaultValue={mode === "local-admin" ? "admin" : undefined}
              maxLength={128}
              minLength={mode === "local-admin" ? 5 : 8}
              name="password"
              required
              type="password"
            />
          </label>
        )}
        {mode === "sign-in" ? (
          <button
            className="auth-text-button"
            onClick={() => {
              setMode("recover");
              setFeedback(undefined);
            }}
            type="button"
          >
            Forgot password?
          </button>
        ) : mode === "recover" ? (
          <button
            className="auth-text-button"
            onClick={() => {
              setMode("sign-in");
              setFeedback(undefined);
            }}
            type="button"
          >
            Back to sign in
          </button>
        ) : null}
        <button disabled={pending} type="submit">
          {pending
            ? "Please wait…"
            : mode === "recover"
              ? "Send reset link"
              : mode === "local-admin"
                ? "Open local dashboard"
                : mode === "sign-in"
                  ? "Sign in securely"
                  : "Create account"}
        </button>
      </form>
    </>
  );
}
