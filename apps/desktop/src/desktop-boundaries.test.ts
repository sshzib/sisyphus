import { describe, expect, it } from "vitest";

import {
  localWorkerUrl,
  parseDevelopmentRendererUrl,
  rendererUrlIsTrusted,
} from "./desktop-boundaries.js";

describe("desktop URL boundaries", () => {
  it("normalizes worker paths and accepts only credential-free loopback origins", () => {
    expect(
      localWorkerUrl("http://127.0.0.1:7331/", "/v1/evidence").href,
    ).toBe("http://127.0.0.1:7331/v1/evidence");
    expect(localWorkerUrl("https://[::1]:7331", "/health").href).toBe(
      "https://[::1]:7331/health",
    );

    expect(() => localWorkerUrl("http://192.0.2.1:7331", "/health")).toThrow(
      "loopback IP",
    );
    expect(() =>
      localWorkerUrl("http://user:password@127.0.0.1:7331", "/health"),
    ).toThrow("origin only");
    expect(() =>
      localWorkerUrl("http://127.0.0.1:7331/base", "/health"),
    ).toThrow("origin only");
  });

  it("permits an unpackaged loopback renderer origin and rejects remote dev content", () => {
    const development = parseDevelopmentRendererUrl("http://127.0.0.1:5173");
    expect(development.origin).toBe("http://127.0.0.1:5173");
    expect(() => parseDevelopmentRendererUrl("https://example.test")).toThrow(
      "loopback IP",
    );
    expect(() =>
      parseDevelopmentRendererUrl("http://127.0.0.1:5173/path"),
    ).toThrow("origin only");
  });

  it("trusts only the selected renderer location for IPC", () => {
    const packagedRendererUrl = "file:///C:/Sisyphus/resources/app.asar/dist/index.html";
    expect(
      rendererUrlIsTrusted({
        candidateUrl: packagedRendererUrl,
        packaged: true,
        packagedRendererUrl,
      }),
    ).toBe(true);
    expect(
      rendererUrlIsTrusted({
        candidateUrl: "https://example.test/",
        packaged: true,
        packagedRendererUrl,
      }),
    ).toBe(false);
    expect(
      rendererUrlIsTrusted({
        candidateUrl: "http://127.0.0.1:5173/dashboard",
        developmentRendererUrl: "http://127.0.0.1:5173",
        packaged: false,
        packagedRendererUrl,
      }),
    ).toBe(true);
    expect(
      rendererUrlIsTrusted({
        candidateUrl: "http://127.0.0.1:5174/",
        developmentRendererUrl: "http://127.0.0.1:5173",
        packaged: false,
        packagedRendererUrl,
      }),
    ).toBe(false);
    expect(
      rendererUrlIsTrusted({
        candidateUrl: "http://127.0.0.1:5173/",
        developmentRendererUrl: "http://127.0.0.1:5173",
        packaged: true,
        packagedRendererUrl,
      }),
    ).toBe(false);
  });
});
