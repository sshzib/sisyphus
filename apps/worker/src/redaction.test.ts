import { describe, expect, it } from "vitest";

import { redactEvidence } from "./redaction.js";

describe("redactEvidence", () => {
  it("removes common provider keys and bearer tokens before upload", () => {
    const source = [
      "OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnop",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "result: tests failed in src/auth.ts",
    ].join("\n");

    const result = redactEvidence({ source, maximumCharacters: 1_000 });

    expect(result.text).toContain("OPENAI_API_KEY=[redacted]");
    expect(result.text).toContain("Authorization: Bearer [redacted]");
    expect(result.text).not.toContain("sk-proj");
    expect(result.redactions).toBe(2);
  });

  it("removes credentials from structured findings before an outbox record exists", () => {
    const result = redactEvidence({
      source: JSON.stringify({
        evidence: [
          "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456",
          "AWS key AKIA1234567890ABCDEF",
        ],
        apiKey: "plain-provider-secret-value",
      }),
      maximumCharacters: 2_000,
    });

    expect(result.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(result.text).not.toContain("AKIA1234567890ABCDEF");
    expect(result.text).not.toContain("plain-provider-secret-value");
    expect(result.redactions).toBe(3);
  });

  it("clips excerpts without splitting a surrogate pair", () => {
    const result = redactEvidence({ source: `pass ✅ ${"x".repeat(100)}`, maximumCharacters: 8 });
    expect(result.text).toBe("pass ✅ …");
  });

  it("rejects a non-positive excerpt limit", () => {
    expect(() => redactEvidence({ source: "value", maximumCharacters: 0 })).toThrow(
      "maximumCharacters",
    );
  });
});
