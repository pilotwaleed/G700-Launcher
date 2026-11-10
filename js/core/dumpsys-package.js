// Parser for `dumpsys package <name>` (Android 12–14 text layout). Pure: text in, plain object out.
// Every permission name is validated before it is returned, so callers may use them as shell tokens.
import { isPackageName, isPermissionName } from "./tokens.js";

const indentOf = (line) => line.length - line.trimStart().length;

function parseEntry(line) {
  const trimmed = line.trim();
  const colon = trimmed.indexOf(":");
  const name = colon === -1 ? trimmed : trimmed.slice(0, colon);
  if (!isPermissionName(name)) return null;
  const rest = colon === -1 ? "" : trimmed.slice(colon + 1);
  const granted = /\bgranted=(true|false)\b/.exec(rest);
  const flags = /\bflags=\[\s*([^\]]*)\]/.exec(rest);
  return {
    name,
    granted: granted ? granted[1] === "true" : null,
    flags: flags ? flags[1].split("|").map((f) => f.trim()).filter(Boolean) : [],
  };
}

/**
 * @param {string} text raw `dumpsys package <pkg>` output
 * @param {string} pkg the package that was asked for
 */
export function parseDumpsysPackage(text, pkg) {
  const result = {
    found: false,
    packageName: pkg,
    versionCode: null,
    versionName: null,
    minSdk: null,
    targetSdk: null,
    requested: [],
    declared: [],
    install: {},
    users: {},
  };
  if (typeof text !== "string" || !isPackageName(pkg)) return result;

  const lines = text.split(/\r?\n/);
  const header = `Package [${pkg}]`;
  const start = lines.findIndex((line) => line.trimStart().startsWith(header));
  if (start === -1) return result;
  const blockIndent = indentOf(lines[start]);
  result.found = true;

  let section = null; // "requested" | "declared" | "install" | "runtime" | null
  let sectionIndent = -1;
  let user = null;
  let userIndent = -1;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (indent <= blockIndent) break; // next package block or next top-level section
    const trimmed = line.trim();

    if (section && indent <= sectionIndent) section = null;
    if (user !== null && indent < userIndent) user = null;

    const userMatch = /^User (\d+):(.*)$/.exec(trimmed);
    if (userMatch) {
      user = userMatch[1];
      userIndent = indent;
      section = null;
      const installed = /\binstalled=(true|false)\b/.exec(userMatch[2]);
      result.users[user] = { installed: installed ? installed[1] === "true" : null, runtime: {} };
      continue;
    }

    if (trimmed === "requested permissions:") { section = "requested"; sectionIndent = indent; continue; }
    if (trimmed === "declared permissions:") { section = "declared"; sectionIndent = indent; continue; }
    if (trimmed === "install permissions:") { section = "install"; sectionIndent = indent; continue; }
    if (trimmed === "runtime permissions:") { section = "runtime"; sectionIndent = indent; continue; }

    if (section) {
      const entry = parseEntry(line);
      if (!entry) continue;
      if (section === "requested") {
        if (!result.requested.includes(entry.name)) result.requested.push(entry.name);
      } else if (section === "declared") {
        result.declared.push(entry.name);
      } else if (section === "install") {
        result.install[entry.name] = entry.granted === true;
      } else if (section === "runtime" && user !== null) {
        result.users[user].runtime[entry.name] = { granted: entry.granted === true, flags: entry.flags };
      }
      continue;
    }

    if (result.versionCode === null) {
      const version = /^versionCode=(\d+)\b(?:.*?\bminSdk=(\d+))?(?:.*?\btargetSdk=(\d+))?/.exec(trimmed);
      if (version) {
        result.versionCode = Number(version[1]);
        result.minSdk = version[2] ? Number(version[2]) : null;
        result.targetSdk = version[3] ? Number(version[3]) : null;
        continue;
      }
    }
    if (result.versionName === null && trimmed.startsWith("versionName=")) {
      result.versionName = trimmed.slice("versionName=".length).trim().slice(0, 64);
    }
  }
  return result;
}

/** Runtime-permission states for the given Android user, falling back to the first user section present. */
export function runtimeStatesFor(parsed, userId = 0) {
  const key = String(userId);
  if (parsed.users[key]) return parsed.users[key].runtime;
  const first = Object.keys(parsed.users)[0];
  return first ? parsed.users[first].runtime : {};
}

/** `pm list packages -3 [--show-versioncode]` → [{name, versionCode}] with invalid lines dropped. */
export function parsePackageList(text) {
  const rows = [];
  const seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const match = /^package:(\S+?)(?:\s+versionCode:(\d+))?\s*$/.exec(raw.trim());
    if (!match || !isPackageName(match[1]) || seen.has(match[1])) continue;
    seen.add(match[1]);
    rows.push({ name: match[1], versionCode: match[2] ? Number(match[2]) : null });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** True when `pm list packages <pkg>` output contains exactly this package (the filter is a substring match). */
export function listContainsPackage(text, pkg) {
  return String(text || "").split(/\r?\n/).some((line) => line.trim().split(/\s+/)[0] === `package:${pkg}`);
}

/** `am get-current-user` → integer, or 0 when the reply is not a plain number. */
export function parseCurrentUser(text) {
  const match = /^\s*(\d{1,4})\s*$/.exec(String(text || ""));
  return match ? Number(match[1]) : 0;
}
