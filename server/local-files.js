import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function validateUploadFile(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192 || !isAbsolute(value)) {
    throw new Error("file_path must be an absolute local path under 8192 characters");
  }
  const filePath = await realpath(value);
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("file_path must point to a regular file");
  if (info.size <= 0) throw new Error("Cannot upload an empty file");
  if (info.size > MAX_UPLOAD_BYTES) throw new Error(`File exceeds the ${MAX_UPLOAD_BYTES}-byte upload limit`);
  return { file_path: filePath, file_name: basename(filePath), size_bytes: info.size };
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
