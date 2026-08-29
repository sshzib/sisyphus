const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function controlPlaneEndpoint(input: {
  readonly baseUrl: string;
  readonly pathname: `/${string}`;
  readonly purpose: string;
}): URL {
  const url = new URL(input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`);
  const secure = url.protocol === "https:";
  const loopbackHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!secure && !loopbackHttp) {
    throw new Error(`${input.purpose} must use HTTPS unless it is on loopback.`);
  }
  url.pathname = input.pathname;
  url.search = "";
  url.hash = "";
  return url;
}
