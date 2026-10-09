import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const dist = join(root, "dist");
const output = join(dist, "pi-browser-bridge-extension.zip");

await mkdir(dist, { recursive: true });
await rm(output, { force: true });

if (process.platform === "win32") {
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Compress-Archive -Path $env:PBB_SOURCE -DestinationPath $env:PBB_OUTPUT -Force",
  ], { env: { ...process.env, PBB_SOURCE: `${source}\\*`, PBB_OUTPUT: output } });
} else {
  await execFileAsync("zip", ["-qr", output, "."], { cwd: source });
}

console.log(`Packaged Chrome extension: ${output}`);
