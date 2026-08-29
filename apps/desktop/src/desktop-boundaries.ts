const loopbackIpHosts = new Set(["127.0.0.1", "[::1]"]);

function parsedUrl(input: string, purpose: string): URL {
  try {
    return new URL(input);
  } catch (error: unknown) {
    throw new Error(`${purpose} must be a valid URL.`, { cause: error });
  }
}

function assertOriginOnly(url: URL, purpose: string): void {
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${purpose} must contain an origin only.`);
  }
}

function assertLoopbackHttp(url: URL, purpose: string): void {
  if (!loopbackIpHosts.has(url.hostname)) {
    throw new Error(`${purpose} must use a loopback IP address.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${purpose} must use HTTP or HTTPS.`);
  }
}

export function localWorkerUrl(baseUrl: string, pathname: string): URL {
  const url = parsedUrl(baseUrl, "The local worker URL");
  assertLoopbackHttp(url, "The local worker URL");
  assertOriginOnly(url, "The local worker URL");
  if (!pathname.startsWith("/")) {
    throw new Error("A local worker pathname must begin with a slash.");
  }
  url.pathname = pathname;
  return url;
}

export function parseDevelopmentRendererUrl(input: string): URL {
  const url = parsedUrl(input, "The desktop development renderer URL");
  assertLoopbackHttp(url, "The desktop development renderer URL");
  assertOriginOnly(url, "The desktop development renderer URL");
  return url;
}

export function rendererUrlIsTrusted(input: {
  readonly candidateUrl: string;
  readonly packaged: boolean;
  readonly packagedRendererUrl: string;
  readonly developmentRendererUrl?: string;
}): boolean {
  try {
    const candidate = new URL(input.candidateUrl);
    if (input.developmentRendererUrl !== undefined) {
      if (input.packaged) return false;
      return (
        candidate.origin ===
        parseDevelopmentRendererUrl(input.developmentRendererUrl).origin
      );
    }
    return candidate.href === new URL(input.packagedRendererUrl).href;
  } catch {
    return false;
  }
}
