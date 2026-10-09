export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 43177;
export const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;
export const MAX_TEXT = 24_000;
export const MAX_INTERACTIVES = 100;

export function parseWebUrl(value, base) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new Error("url must be a non-empty URL under 8192 characters");
  }
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS pages can be opened");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded usernames or passwords are refused");
  }
  return url.href;
}

export function extensionIdFromOrigin(origin) {
  if (typeof origin !== "string") return null;
  return EXTENSION_ORIGIN.exec(origin)?.[1] ?? null;
}

export function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function isSensitiveField({ type, name, id, autocomplete, ariaLabel, placeholder } = {}) {
  const normalizedType = String(type ?? "").toLowerCase();
  if (["password", "hidden", "file"].includes(normalizedType)) return true;
  const descriptor = [name, id, autocomplete, ariaLabel, placeholder].filter(Boolean).join(" ").toLowerCase();
  return /password|passcode|secret|token|csrf|authenticity|one.?time|otp|2fa|verification.?code|recovery.?code|private.?key/.test(descriptor);
}

export function normalizeSelector(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw new Error("selector must be a non-empty CSS selector under 2048 characters");
  }
  return value.trim();
}
