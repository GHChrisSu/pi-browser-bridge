import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const dist = join(root, "dist");
const output = join(dist, "pi-browser-bridge-extension.zip");
const unpackedOutput = join(dist, "pi-browser-bridge-extension");

await mkdir(dist, { recursive: true });
await rm(output, { force: true });
await rm(unpackedOutput, { recursive: true, force: true });
await cp(source, unpackedOutput, { recursive: true });

if (process.platform === "win32") {
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Compress-Archive -Path $env:PBB_SOURCE -DestinationPath $env:PBB_OUTPUT -Force",
  ], { env: { ...process.env, PBB_SOURCE: `${unpackedOutput}\\*`, PBB_OUTPUT: output } });
} else {
  await execFileAsync("zip", ["-qr", output, "."], { cwd: unpackedOutput });
}

console.log(`Exported unpacked Chrome extension: ${unpackedOutput}`);
console.log(`Packaged Chrome extension ZIP: ${output}`);
