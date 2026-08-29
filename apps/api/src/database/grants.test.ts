import { describe, expect, it } from "vitest";
import { postgresRoleFromUrl } from "./grants.js";

describe("PostgreSQL role URL boundary", () => {
  it("extracts a restricted SQL identifier from an encoded URL role", () => {
    expect(
      postgresRoleFromUrl(
        "postgresql://sisyphus_app:secret@db.example.test:5432/control-plane",
      ),
    ).toBe("sisyphus_app");
  });

  it("rejects empty or unsafe role identifiers before composing grants", () => {
    expect(() =>
      postgresRoleFromUrl("postgresql://db.example.test/control-plane"),
    ).toThrow();
    expect(() =>
      postgresRoleFromUrl(
        "postgresql://unsafe-role:secret@db.example.test/control-plane",
      ),
    ).toThrow();
  });
});
