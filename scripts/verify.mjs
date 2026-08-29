import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  const needsCommandShell = process.platform === "win32" && command.endsWith(".cmd");
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: needsCommandShell,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const manifestPath = join(root, "plugins", "sisyphus-codex", ".codex-plugin", "plugin.json");
const hooksPath = join(root, "plugins", "sisyphus-codex", "hooks", "hooks.json");

if (!existsSync(manifestPath) || !existsSync(hooksPath)) {
  throw new Error("Codex plugin manifest or hooks configuration is missing.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.name !== "sisyphus-codex") {
  throw new Error("Codex plugin name and folder must both be sisyphus-codex.");
}

run(process.execPath, ["scripts/check-boundaries.mjs"]);
run(process.execPath, ["scripts/check-ui-style.mjs"]);
run(pnpm, ["typecheck"]);
run(pnpm, ["test"]);
run(pnpm, ["build"]);
run(pnpm, ["--filter", "@sisyphus/desktop", "package:dir"]);
run(pnpm, ["--filter", "@sisyphus/desktop", "smoke:packaged-worker"]);

process.stdout.write("Sisyphus verification passed.\n");
