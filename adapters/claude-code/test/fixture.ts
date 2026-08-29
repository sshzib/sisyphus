import { readFileSync } from "node:fs";

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));
}
