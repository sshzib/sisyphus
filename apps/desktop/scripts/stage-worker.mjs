import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(desktopDirectory, "..", "worker", "dist");
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
await cp(source, destination, { recursive: true, force: true });
