import { readFileSync } from "node:fs";

export function loadFixture(name: string): unknown {
  const source = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  const value: unknown = JSON.parse(source);
  return value;
}
