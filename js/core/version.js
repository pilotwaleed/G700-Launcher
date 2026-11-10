// Release manifest (apks/latest.json) validation and version comparison. Pure.
import { APK_FILE_RE } from "./tokens.js";

const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^\d{1,4}(?:\.\d{1,5}){0,3}(?:[-+][0-9A-Za-z.-]{1,32})?$/;

/**
 * @returns {{state: "published", version, versionCode, file, size, sha256, date}
 *          | {state: "none", version: string|null, versionCode: number|null}
 *          | {state: "invalid", problems: string[]}}
 */
export function validateRelease(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { state: "invalid", problems: ["not-an-object"] };
  const version = typeof raw.version === "string" && VERSION_RE.test(raw.version) ? raw.version : null;
  const versionCode = Number.isInteger(raw.versionCode) && raw.versionCode > 0 ? raw.versionCode : null;
  if (raw.file === null || raw.file === undefined || raw.file === "") return { state: "none", version, versionCode };

  const problems = [];
  if (typeof raw.file !== "string" || !APK_FILE_RE.test(raw.file)) problems.push("file");
  if (version === null) problems.push("version");
  if (versionCode === null) problems.push("versionCode");
  if (!Number.isInteger(raw.size) || raw.size <= 0) problems.push("size");
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.trim().toLowerCase() : "";
  if (!SHA256_RE.test(sha256)) problems.push("sha256");
  if (problems.length) return { state: "invalid", problems };
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  return { state: "published", version, versionCode, file: raw.file, size: raw.size, sha256, date };
}

/** Numeric dotted compare: -1, 0, 1. Non-numeric parts compare as 0; suffixes after - or + are ignored. */
export function compareVersionNames(a, b) {
  const parts = (v) => String(v ?? "").split(/[-+]/)[0].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @param {number|null} installedCode versionCode on the car, or null when the launcher is not installed
 * @param {number|null} latestCode versionCode in latest.json, or null when nothing is published
 * @returns {"not-installed"|"unknown"|"update-available"|"up-to-date"|"newer-installed"}
 */
export function updateStatus(installedCode, latestCode) {
  if (!Number.isInteger(latestCode)) return installedCode === null ? "not-installed" : "unknown";
  if (installedCode === null) return "not-installed";
  if (!Number.isInteger(installedCode)) return "unknown";
  if (installedCode < latestCode) return "update-available";
  return installedCode === latestCode ? "up-to-date" : "newer-installed";
}

export const sameDigest = (a, b) =>
  typeof a === "string" && typeof b === "string" && SHA256_RE.test(a.trim().toLowerCase()) && a.trim().toLowerCase() === b.trim().toLowerCase();

/** SHA-256 of a Blob/ArrayBuffer/Uint8Array as lowercase hex, using WebCrypto (browser and Node). */
export async function sha256Hex(data) {
  const buffer = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? data : await data.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
