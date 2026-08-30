import { NextResponse } from "next/server";
import { loadHostedConfiguration } from "../../../lib/hosted-config";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

type SupportedEmailOtpType = "email" | "recovery" | "signup";

export async function GET(request: Request) {
  let configuration;
  try {
    configuration = loadHostedConfiguration();
  } catch {
    return NextResponse.redirect(new URL("/?authError=configuration", request.url));
  }
  if (configuration.kind === "unconfigured") {
    return NextResponse.redirect(new URL("/?authError=configuration", request.url));
  }
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = parseEmailOtpType(url.searchParams.get("type"));
  if (tokenHash === null || type === undefined) {
    return NextResponse.redirect(new URL("/?authError=confirmation", request.url));
  }
  const supabase = await createSupabaseServerClient(configuration);
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  const destination =
    error === null
      ? type === "recovery"
        ? "/auth/update-password"
        : "/?authStatus=confirmed"
      : type === "recovery"
        ? "/?authError=recovery"
        : "/?authError=confirmation";
  return NextResponse.redirect(
    new URL(destination, request.url),
  );
}

function parseEmailOtpType(input: string | null): SupportedEmailOtpType | undefined {
  return input === "email" || input === "recovery" || input === "signup"
    ? input
    : undefined;
}
