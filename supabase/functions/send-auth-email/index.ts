import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import {
  parseAuthEmailConfiguration,
  parseAuthEmailHookPayload,
  planAuthEmails,
  type PlannedAuthEmail,
} from "../_shared/auth-email.ts";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const MAX_HOOK_BODY_BYTES = 64 * 1_024;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return errorResponse(405, "Method not allowed.", { Allow: "POST" });
  }

  let configuration;
  try {
    configuration = parseAuthEmailConfiguration({
      hookSecret: Deno.env.get("SEND_EMAIL_HOOK_SECRET"),
      privacyUrl: Deno.env.get("SISYPHUS_PRIVACY_URL"),
      resendApiKey: Deno.env.get("RESEND_API_KEY"),
      sender: Deno.env.get("SISYPHUS_AUTH_EMAIL_FROM"),
      unsubscribeUrl: Deno.env.get("SISYPHUS_UNSUBSCRIBE_URL"),
      webOrigin: Deno.env.get("SISYPHUS_WEB_ORIGIN"),
    });
  } catch (error) {
    logSafeFailure("configuration", error);
    return errorResponse(500, "Auth email delivery is not configured.");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_HOOK_BODY_BYTES) {
    return errorResponse(413, "Hook payload is too large.");
  }

  let verifiedPayload: unknown;
  try {
    verifiedPayload = new Webhook(configuration.hookSecret).verify(
      rawBody,
      Object.fromEntries(request.headers),
    );
  } catch {
    return errorResponse(401, "Hook signature is invalid.");
  }

  let emails: PlannedAuthEmail[];
  try {
    const hook = parseAuthEmailHookPayload(verifiedPayload);
    emails = planAuthEmails(hook, configuration);
  } catch (error) {
    logSafeFailure("payload", error);
    return errorResponse(422, "Hook payload is unsupported or invalid.");
  }

  try {
    await Promise.all(
      emails.map((email) => sendAuthEmail(email, configuration.resendApiKey)),
    );
  } catch (error) {
    logSafeFailure("provider", error);
    return errorResponse(502, "Auth email provider rejected the request.");
  }

  return Response.json({}, { status: 200 });
});

async function sendAuthEmail(
  email: PlannedAuthEmail,
  resendApiKey: string,
): Promise<void> {
  const response = await fetch(RESEND_EMAIL_ENDPOINT, {
    body: JSON.stringify(email.request),
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": email.idempotencyKey,
      "User-Agent": "sisyphus-auth-email-hook/0.1.0",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Resend returned HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.id !== "string" || body.id.length === 0) {
    throw new Error("Resend returned an invalid response.");
  }
}

function errorResponse(
  status: number,
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { error: { http_code: status, message } },
    { status, headers: extraHeaders },
  );
}

function logSafeFailure(stage: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : "Unknown failure.";
  console.error(`Auth email ${stage} failure: ${reason}`);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
