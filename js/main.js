// Boot: shared state, tabs, language, connection lifecycle. Views render from `app` and never talk to WebUSB directly.
import { t, setLang, loadSavedLang, getLang, onLangChange } from "./i18n.js";
import { h, icon, toast, activityLog, copyText } from "./ui.js";
import { AdbSession, ConnectError } from "./adb-session.js";
import { JournalStore, deviceKeyFor } from "./core/journal.js";
import { validateRelease } from "./core/version.js";
import { redactText } from "./core/redact.js";
import { readProps, DEVICE_PROPS, readLauncherState, listUserApps, readCurrentUser } from "./core/pipeline.js";
import { LAUNCHER } from "./core/grant-plan.js";
import { isPackageName, cmd } from "./core/tokens.js";
import * as connectView from "./views/connect.js";
import * as installView from "./views/install.js";
import * as permissionsView from "./views/permissions.js";
import * as appsView from "./views/apps.js";
import * as catalogView from "./views/catalog.js";
import * as toolsView from "./views/tools.js";

const TABS = [
  ["connect", "usb", connectView],
  ["install", "download", installView],
  ["permissions", "shield", permissionsView],
  ["apps", "grid", appsView],
  ["catalog", "store", catalogView],
  ["tools", "wrench", toolsView],
];

function safeStorage() {
  try {
    const storage = window.localStorage;
    storage.getItem("g700wi.probe");
    return storage;
  } catch {
    return null;
  }
}

/** Properties whose value is the serial: read once to know what to hide, never written to the log or a report. */
const SERIAL_PROPS = ["ro.serialno", "ro.boot.serialno"];
const isSerialQuery = (command) => SERIAL_PROPS.some((key) => command === cmd.getprop(key));

const session = new AdbSession({
  onCommand: (command, reply) => activityLog.command(command, isSerialQuery(command) ? { output: "[hidden]", exitCode: reply.exitCode } : reply),
  onDisconnect: () => {
    app.connected = false;
    app.device = null;
    app.launcher = { installed: false, versionName: null, versionCode: null };
    app.userApps = [];
    activityLog.add("info", "device disconnected");
    toast(t("connect.unplugged"), "bad");
    app.render();
  },
});

export const app = {
  supported: AdbSession.supported && window.isSecureContext,
  connected: false,
  connecting: false,
  busy: false,
  device: null, // {serial, props, currentUser}
  deviceKey: null,
  deviceSerials: [], // other spellings of the serial (ro.serialno…), used only for redaction
  launcher: { installed: false, versionName: null, versionCode: null },
  userApps: [], // [{name, versionCode}]
  release: { state: "loading" },
  catalog: null, // null = loading, false = failed
  labels: new Map(), // package → display name, from catalog.json
  journalStore: new JournalStore(safeStorage()),
  dev: {
    shell: (command) => session.shell(command),
    push: (path, blob, onProgress) => session.push(path, blob, onProgress),
  },

  userInstalled() {
    return new Set(this.userApps.map((entry) => entry.name));
  },
  labelFor(pkg) {
    if (pkg === LAUNCHER.package) return t("brand.name");
    return this.labels.get(pkg) ?? pkg.split(".").slice(-2).join(".");
  },

  /** Runs one task at a time. @returns {Promise<boolean>} false when another task was already running. */
  async exclusive(task) {
    if (this.busy) {
      toast(t("common.busy"), "bad");
      return false;
    }
    this.busy = true;
    this.render();
    try {
      await task();
    } catch (error) {
      const message = this.connected ? t("err.generic", { message: String(error?.message ?? error).slice(0, 200) }) : t("err.disconnected");
      activityLog.add("error", String(error?.stack ?? error));
      toast(message, "bad");
    } finally {
      this.busy = false;
      this.render();
    }
    return true;
  },

  async connect() {
    if (this.connecting || this.connected) return;
    this.connecting = true;
    this.render();
    try {
      const { serial } = await session.connect();
      activityLog.setRedactor((text) => redactText(text, [serial]));
      const others = [];
      for (const key of SERIAL_PROPS) others.push((await session.shell(cmd.getprop(key))).output.trim());
      this.deviceSerials = [...new Set(others.filter((value) => value.length >= 4))];
      activityLog.setRedactor((text) => redactText(text, [serial, ...this.deviceSerials]));
      this.deviceKey = await deviceKeyFor(serial);
      this.connected = true;
      this.device = { serial, props: {}, currentUser: 0 };
      activityLog.add("info", "connected; ADB handshake complete");
      await this.refreshDevice();
      toast(t("connect.connected"), "ok");
    } catch (error) {
      if (session.connected) await session.disconnect();
      this.connected = false;
      this.device = null;
      const kind = error instanceof ConnectError ? error.kind : "generic";
      if (kind !== "cancelled") activityLog.add("error", `connect failed (${kind}): ${error?.message ?? error}`);
      toast(kind === "generic" ? t("connect.err.generic", { message: String(error?.message ?? error).slice(0, 200) }) : t(`connect.err.${kind}`), kind === "cancelled" ? "info" : "bad");
    } finally {
      this.connecting = false;
      this.render();
    }
  },

  async disconnect() {
    await session.disconnect();
    this.connected = false;
    this.device = null;
    this.userApps = [];
    this.launcher = { installed: false, versionName: null, versionCode: null };
    activityLog.add("info", "disconnected");
    this.render();
  },

  /** Re-reads device properties, the launcher's state and the user-installed app list. */
  async refreshDevice() {
    if (!this.connected) return;
    const props = await readProps(this.dev, DEVICE_PROPS);
    const currentUser = await readCurrentUser(this.dev);
    this.device = { serial: session.serial, props, currentUser };
    const state = await readLauncherState(this.dev);
    this.launcher = { installed: state.installed, versionName: state.versionName, versionCode: state.versionCode };
    await this.refreshApps();
  },

  async refreshApps() {
    if (!this.connected) return;
    this.userApps = await listUserApps(this.dev);
    this.render();
  },

  async loadRelease() {
    try {
      const response = await fetch("apks/latest.json", { cache: "no-store" });
      this.release = response.ok ? validateRelease(await response.json()) : { state: "none", version: null, versionCode: null };
    } catch {
      this.release = { state: "none", version: null, versionCode: null };
    }
    this.render();
  },

  async loadCatalog() {
    try {
      const response = await fetch("catalog.json", { cache: "no-cache" });
      const data = response.ok ? await response.json() : null;
      this.catalog = data && Array.isArray(data.apps) ? data : false;
    } catch {
      this.catalog = false;
    }
    this.rebuildLabels();
    this.render();
  },

  rebuildLabels() {
    this.labels.clear();
    if (!this.catalog) return;
    for (const entry of this.catalog.apps) {
      const name = entry?.name?.[getLang()] ?? entry?.name?.en;
      if (typeof name !== "string") continue;
      for (const pkg of Array.isArray(entry.packages) ? entry.packages : []) if (isPackageName(pkg)) this.labels.set(pkg, name);
    }
  },

  go(tab) {
    for (const [id] of TABS) {
      document.getElementById(`view-${id}`).hidden = id !== tab;
      document.getElementById(`tab-${id}`).setAttribute("aria-selected", String(id === tab));
    }
    window.scrollTo({ top: 0 });
  },

  render() {
    const pill = document.getElementById("conn-pill");
    pill.dataset.state = this.busy || this.connecting ? "busy" : this.connected ? "on" : "off";
    const pillText = document.getElementById("conn-pill-text");
    delete pillText.dataset.i18n;
    pillText.textContent = this.busy || this.connecting ? t("conn.busy") : this.connected ? t("conn.on", { model: this.device?.props["ro.product.model"] || "ADB" }) : t("conn.off");
    for (const button of document.querySelectorAll(".lang-btn")) button.setAttribute("aria-pressed", String(button.dataset.lang === getLang()));
    for (const [, , view] of TABS) view.render();
  },
};

function boot() {
  const tabs = document.getElementById("tabs");
  TABS.forEach(([id, iconName], index) => {
    tabs.append(h("button", { type: "button", class: "tab", id: `tab-${id}`, role: "tab", "aria-controls": `view-${id}`, "aria-selected": "false", on: { click: () => app.go(id) } },
      icon(iconName), h("span", { i18n: `tab.${id}` }), h("span", { class: "tab-num", text: String(index + 1) })));
  });
  for (const [id, , view] of TABS) {
    const root = document.getElementById(`view-${id}`);
    root.setAttribute("aria-labelledby", `tab-${id}`);
    if (id === "catalog") view.init(root, app, { installFiles: (files) => { if (app.connected) app.go("apps"); appsView.enqueue(files); } });
    else view.init(root, app);
  }
  for (const button of document.querySelectorAll(".lang-btn")) button.addEventListener("click", () => setLang(button.dataset.lang));
  document.getElementById("log-copy").addEventListener("click", () => copyText(activityLog.text()));
  document.getElementById("log-clear").addEventListener("click", () => activityLog.clear());

  const banner = document.getElementById("support-banner");
  if (!app.supported) {
    banner.hidden = false;
    banner.append(icon("warn"), h("span", { i18n: window.isSecureContext ? "support.noWebUsb" : "support.insecure" }));
  }

  onLangChange(() => { app.rebuildLabels(); app.render(); });
  setLang(loadSavedLang());
  app.go("connect");
  app.loadRelease();
  app.loadCatalog();
}

boot();
