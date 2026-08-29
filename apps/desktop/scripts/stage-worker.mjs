import { mkdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(desktopDirectory, "..", "worker", "dist", "index.js");
const destination = resolve(desktopDirectory, "dist-worker");
const relativeDestination = relative(desktopDirectory, destination);
if (
  relativeDestination === "" ||
  relativeDestination.startsWith("..") ||
  relativeDestination.includes(":")
) {
  throw new Error("Refusing to stage the worker outside the desktop package.");
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await build({
  entryPoints: [source],
  outfile: resolve(destination, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  legalComments: "none",
  sourcemap: false,
});
