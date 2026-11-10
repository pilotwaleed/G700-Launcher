// Which packages this site may manage. Two independent rules, both must pass:
//  1. the package is in the car's own "user-installed" list (`pm list packages -3`), and
//  2. its name is not under a platform / vehicle-maker / chipset prefix.
import { isPackageName } from "./tokens.js";

/** Exact names that are always refused. */
export const PROTECTED_EXACT = ["android"];

/** Name prefixes that are always refused, even if the car were to list them as user-installed. */
export const PROTECTED_PREFIXES = [
  "android.",
  "com.android.",
  "com.autolink.",
  "com.chery.",
  "com.jetour.",
  "com.qualcomm.",
  "com.qti.",
  "com.quicinc.",
  "org.codeaurora.",
  "vendor.",
  "com.google.android.gms",
  "com.google.android.gsf",
  "com.google.android.car",
  "com.google.android.permissioncontroller",
  "com.google.android.packageinstaller",
  "com.google.android.ext.",
];

export function isProtectedPackage(pkg) {
  if (typeof pkg !== "string") return true;
  const name = pkg.toLowerCase();
  if (PROTECTED_EXACT.includes(name)) return true;
  return PROTECTED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * @param {string} pkg
 * @param {Iterable<string>} userInstalled package names from `pm list packages -3`, read in this session
 * @returns {{ok: true} | {ok: false, reason: "invalid" | "protected" | "not-user-installed"}}
 */
export function checkManageable(pkg, userInstalled) {
  if (!isPackageName(pkg)) return { ok: false, reason: "invalid" };
  if (isProtectedPackage(pkg)) return { ok: false, reason: "protected" };
  const set = userInstalled instanceof Set ? userInstalled : new Set(userInstalled || []);
  if (!set.has(pkg)) return { ok: false, reason: "not-user-installed" };
  return { ok: true };
}

export class GuardError extends Error {
  constructor(pkg, reason) {
    super(`refused for ${String(pkg).slice(0, 80)}: ${reason}`);
    this.name = "GuardError";
    this.reason = reason;
  }
}

export function assertManageable(pkg, userInstalled) {
  const verdict = checkManageable(pkg, userInstalled);
  if (!verdict.ok) throw new GuardError(pkg, verdict.reason);
  return pkg;
}

/**
 * Last-moment check on a finished command string: an uninstall or force-stop must not name a protected package.
 * (The views already call assertManageable; this is a second, independent line.)
 */
export function assertCommandTargetsAllowed(command) {
  const match = /^(?:pm uninstall(?: -k)?|am force-stop) (\S+)$/.exec(command);
  if (match && isProtectedPackage(match[1])) throw new GuardError(match[1], "protected");
  return command;
}
