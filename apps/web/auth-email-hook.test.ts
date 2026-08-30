import { describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_TEMPLATE_ALIASES,
  parseAuthEmailConfiguration,
  parseAuthEmailHookPayload,
  planAuthEmails,
} from "../../supabase/functions/_shared/auth-email";

const configuration = parseAuthEmailConfiguration({
  hookSecret: "v1,whsec_this-is-a-long-test-hook-secret",
  privacyUrl: undefined,
  resendApiKey: "re_this-is-a-long-test-resend-key",
  sender: undefined,
  unsubscribeUrl: undefined,
  webOrigin: "http://localhost:3000",
});

describe("Supabase auth email hook planning", () => {
  it("maps signup to the published verification and welcome templates", () => {
    const hook = parseAuthEmailHookPayload(
      hookPayload({ action: "signup", name: "  Ada   Lovelace  " }),
    );
    const emails = planAuthEmails(hook, configuration);

    expect(emails).toHaveLength(2);
    expect(emails.map((email) => email.request.template.id)).toEqual([
      AUTH_EMAIL_TEMPLATE_ALIASES.verification,
      AUTH_EMAIL_TEMPLATE_ALIASES.welcome,
    ]);
    expect(emails[0]?.request.template.variables).toEqual({
      name: "Ada Lovelace",
      verification_code: "305805",
      verification_url:
        "http://localhost:3000/auth/confirm?token_hash=0123456789abcdef0123456789abcdef&type=signup",
    });
    expect(emails[1]?.request.template.variables).toEqual({
      dashboard_url: "http://localhost:3000/",
      name: "Ada Lovelace",
      privacy_url: "http://localhost:3000/privacy",
      unsubscribe_url: "http://localhost:3000/unsubscribe",
    });
    expect(emails[1]?.idempotencyKey).toBe(
      "sisyphus/welcome/8484b834-f29e-4af2-bf42-80644d154f76",
    );
  });

  it("maps recovery to the published password reset template", () => {
    const hook = parseAuthEmailHookPayload(
      hookPayload({ action: "recovery", name: undefined }),
    );
    const [email] = planAuthEmails(hook, configuration);

    expect(email?.request.template).toEqual({
      id: AUTH_EMAIL_TEMPLATE_ALIASES.passwordReset,
      variables: {
        name: "Developer",
        reset_url:
          "http://localhost:3000/auth/confirm?token_hash=0123456789abcdef0123456789abcdef&type=recovery",
      },
    });
  });

  it("uses only the configured origin and rejects unsupported actions", () => {
    const hook = parseAuthEmailHookPayload(
      hookPayload({ action: "signup", name: "Grace" }),
    );
    const [email] = planAuthEmails(hook, configuration);

    expect(email?.request.template.variables.verification_url).not.toContain(
      "attacker.example.test",
    );
    expect(() =>
      parseAuthEmailHookPayload(
        hookPayload({ action: "magiclink", name: "Grace" }),
      ),
    ).toThrow(/Unsupported email action/u);
  });

  it("rejects public HTTP origins and malformed secrets", () => {
    expect(() =>
      parseAuthEmailConfiguration({
        hookSecret: "v1,whsec_this-is-a-long-test-hook-secret",
        privacyUrl: undefined,
        resendApiKey: "re_this-is-a-long-test-resend-key",
        sender: undefined,
        unsubscribeUrl: undefined,
        webOrigin: "http://sisyphus.example.test",
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseAuthEmailConfiguration({
        hookSecret: "not-a-standard-webhook-secret",
        privacyUrl: undefined,
        resendApiKey: "re_this-is-a-long-test-resend-key",
        sender: undefined,
        unsubscribeUrl: undefined,
        webOrigin: "http://localhost:3000",
      }),
    ).toThrow(/invalid format/u);
  });
});

function hookPayload(input: Readonly<{ action: string; name: string | undefined }>) {
  return {
    email_data: {
      email_action_type: input.action,
      redirect_to: "https://attacker.example.test/steal",
      site_url: "https://attacker.example.test",
      token: "305805",
      token_hash: "0123456789abcdef0123456789abcdef",
    },
    user: {
      email: "DEVELOPER@EXAMPLE.COM",
      id: "8484b834-f29e-4af2-bf42-80644d154f76",
      user_metadata: input.name === undefined ? {} : { name: input.name },
    },
  };
}
