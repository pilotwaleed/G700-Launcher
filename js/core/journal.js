// Local journal of what this site changed on a car, so Uninstall can report what it reverses.
// Same idea as tools/g700ctl.py journal_write(): one entry per install / repair / uninstall.
// Storage is injected (localStorage in the browser, a Map-backed fake in tests). Entries never hold the serial:
// a car is identified by a short SHA-256 prefix of it.
import { sha256Hex } from "./version.js";

export const JOURNAL_KEY = "g700wi.journal.v1";
const MAX_ENTRIES_PER_DEVICE = 40;

export async function deviceKeyFor(serial) {
  const digest = await sha256Hex(new TextEncoder().encode(`g700wi:${String(serial ?? "")}`));
  return digest.slice(0, 16);
}

export class JournalStore {
  /** @param storage object with getItem(key) / setItem(key, value); may throw (private mode) */
  constructor(storage) {
    this.storage = storage;
    this.memory = {};
  }
  #read() {
    try {
      const raw = this.storage?.getItem(JOURNAL_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* fall through to memory */ }
    return this.memory;
  }
  #write(all) {
    this.memory = all;
    try {
      this.storage?.setItem(JOURNAL_KEY, JSON.stringify(all));
      return true;
    } catch {
      return false;
    }
  }
  entries(deviceKey) {
    const list = this.#read()[deviceKey];
    return Array.isArray(list) ? list : [];
  }
  /** @returns {boolean} true when the entry reached persistent storage */
  append(deviceKey, entry) {
    const all = { ...this.#read() };
    all[deviceKey] = [...(Array.isArray(all[deviceKey]) ? all[deviceKey] : []), entry].slice(-MAX_ENTRIES_PER_DEVICE);
    return this.#write(all);
  }
}

/**
 * What the journal says is currently changed on the car by this site (since the last uninstall entry).
 * @returns {{known: boolean, installedAt: string|null, lastTool: string|null, grants: Array<{kind, name}>, skipped: Array<{kind, name}>,
 *            dozeWhitelist: boolean, notificationListener: boolean, wasInstalledBefore: boolean|null}}
 */
export function summarizeJournal(entries) {
  const summary = {
    known: false, installedAt: null, lastTool: null, grants: [], skipped: [],
    dozeWhitelist: false, notificationListener: false, wasInstalledBefore: null,
  };
  const list = Array.isArray(entries) ? entries : [];
  let from = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.tool === "web-installer uninstall") { from = i + 1; break; }
  }
  const granted = new Map();
  const skipped = new Map();
  for (const entry of list.slice(from)) {
    if (!entry || (entry.tool !== "web-installer install" && entry.tool !== "web-installer repair")) continue;
    summary.known = true;
    summary.lastTool = entry.tool;
    if (entry.tool === "web-installer install") {
      summary.installedAt = entry.at ?? summary.installedAt;
      if (summary.wasInstalledBefore === null) summary.wasInstalledBefore = entry.wasInstalled === true;
    }
    for (const grant of Array.isArray(entry.grants) ? entry.grants : []) {
      const id = `${grant.kind}:${grant.name}`;
      if (grant.ok) { granted.set(id, { kind: grant.kind, name: grant.name }); skipped.delete(id); }
      else if (!granted.has(id)) skipped.set(id, { kind: grant.kind, name: grant.name });
    }
    if (entry.dozeWhitelist) summary.dozeWhitelist = true;
  }
  summary.grants = [...granted.values()];
  summary.skipped = [...skipped.values()];
  summary.notificationListener = summary.grants.some((grant) => grant.kind === "notification");
  return summary;
}
