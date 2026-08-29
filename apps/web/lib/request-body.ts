import "server-only";

export function requestMediaType(headers: Headers): string {
  return (headers.get("content-type")?.split(";", 1)[0] ?? "")
    .trim()
    .toLowerCase();
}

export async function readBoundedRequestBody(input: {
  request: Request;
  maximumBytes: number;
}): Promise<string | undefined> {
  const declaredLength = Number(input.request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > input.maximumBytes
  ) {
    return undefined;
  }
  if (input.request.body === null) {
    return "";
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = input.request.body.getReader();
  let bytesRead = 0;
  let body = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        body += decoder.decode();
        return body;
      }
      bytesRead += result.value.byteLength;
      if (bytesRead > input.maximumBytes) {
        await reader.cancel();
        return undefined;
      }
      body += decoder.decode(result.value, { stream: true });
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  }
}
