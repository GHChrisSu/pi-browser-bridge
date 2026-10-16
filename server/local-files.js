import { realpath, stat, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SECRET_DIRS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", join(".config", "gcloud"), join(".config", "gh")]
  .map((directory) => join(homedir(), directory));
const SECRET_FILE_NAME = /(^|[\\/])(\.env(\..*)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)(_sk)?|[^\\/]*\.(pem|key|p12|pfx|jks|keystore|kdbx))$/i;

function isSensitiveUpload(filePath) {
  const path = filePath.toLowerCase();
  return SECRET_DIRS.some((directory) => {
    const root = directory.toLowerCase();
    return path === root || path.startsWith(`${root}${sep.toLowerCase()}`);
  }) || SECRET_FILE_NAME.test(filePath);
}

export async function validateUploadFile(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192 || !isAbsolute(value)) {
    throw new Error("file_path must be an absolute local path under 8192 characters");
  }
  const filePath = await realpath(value);
  if (isSensitiveUpload(filePath)) throw new Error("Refusing to upload a sensitive key or credential file");
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("file_path must point to a regular file");
  if (info.size <= 0) throw new Error("Cannot upload an empty file");
  if (info.size > MAX_UPLOAD_BYTES) throw new Error(`File exceeds the ${MAX_UPLOAD_BYTES}-byte upload limit`);
  return { file_path: filePath, file_name: basename(filePath), size_bytes: info.size };
}

export async function validateNewOutputFile(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192 || !isAbsolute(value)) {
    throw new Error("output_path must be an absolute local path under 8192 characters");
  }
  const requested = resolve(value);
  const parent = await realpath(dirname(requested));
  const parentInfo = await stat(parent);
  if (!parentInfo.isDirectory()) throw new Error("output_path parent must be a directory");
  const outputPath = join(parent, basename(requested));
  if (isSensitiveUpload(outputPath)) throw new Error("Refusing to write a page archive to a sensitive key or credential path");
  try {
    await lstat(outputPath);
    throw new Error("output_path already exists; refusing to overwrite it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { output_path: outputPath };
}

export function parseHttpOrigin(value) {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("target_origin must be an HTTP or HTTPS origin");
  let url;
  try { url = new URL(value); } catch { throw new Error("target_origin must be an HTTP or HTTPS origin"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new Error("target_origin must be an HTTP or HTTPS origin without credentials");
  }
  if (url.origin !== value.replace(/\/$/, "")) throw new Error("target_origin must contain only scheme, hostname, and optional port");
  return url.origin;
}
