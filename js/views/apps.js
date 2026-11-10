// Apps: install APK files, list user-installed packages, launch / force stop / uninstall with the package guard.
import { t } from "../i18n.js";
import { h, icon, ltr, note, rawDetails, confirmDialog, toast, dropZone, isApkFile } from "../ui.js";
import { installApk, uninstallApp, forceStopApp, launchApp } from "../core/pipeline.js";
import { checkManageable } from "../core/package-guard.js";
import { LAUNCHER } from "../core/grant-plan.js";
import { formatBytes } from "../core/version.js";
import { viewHead, panel, requireConnection } from "./shared.js";

let app;
let queueBox, listBox, listTitle, search;
const queue = []; // {file, name, size, status: "waiting"|"pushing"|"installing"|"ok"|"failed"|"notApk", progress, command, output}
let draining = false;
let slot = 0;
let filter = "";

export function init(root, appRef) {
  app = appRef;
  queueBox = h("ul", { class: "queue" });
  listBox = h("div", {});
  listTitle = h("span", {});
  search = h("input", { type: "search", class: "input", i18nPlaceholder: "apps.search", i18nLabel: "apps.search", on: { input: () => { filter = search.value.trim().toLowerCase(); render(); } } });
  root.append(
    viewHead("apps.title", "apps.lead"),
    panel("apps.install.title", "download",
      h("div", { class: "stack" },
        dropZone({ multiple: true, labelKey: "apps.install.drop", chooseKey: "apps.install.choose", onFiles: enqueue }),
        queueBox,
      ),
    ),
    h("section", { class: "panel glass" },
      h("h2", {}, icon("grid"), listTitle),
      h("div", { class: "row" }, search, h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn btn-quiet btn-small", id: "apps-refresh", on: { click: () => app.exclusive(() => app.refreshApps()) } }, icon("refresh"), h("span", { i18n: "common.refresh" }))),
      listBox,
    ),
  );
}

/** Called by the drop zone here and by the Get apps cards. */
export function enqueue(files) {
  if (!requireConnection(app)) return;
  if (app.busy && !draining) {
    toast(t("common.busy"), "bad");
    return;
  }
  for (const file of files) {
    queue.push({ file, name: file.name, size: file.size, status: isApkFile(file) ? "waiting" : "notApk", progress: 0, command: "", output: "" });
  }
  render();
  if (!draining) drain();
}

async function drain() {
  draining = true;
  await app.exclusive(async () => {
    for (;;) {
      const item = queue.find((entry) => entry.status === "waiting");
      if (!item || !app.connected) break;
      item.status = "pushing";
      render();
      try {
        const result = await installApk({
          dev: app.dev, blob: item.file, slot: slot++ % 1000,
          onProgress: (sent, total) => {
            item.progress = total ? sent / total : 0;
            if (item.progress >= 1) item.status = "installing";
            render();
          },
        });
        item.status = result.ok ? "ok" : "failed";
        item.command = result.command;
        item.output = result.output;
      } catch (error) {
        item.status = "failed";
        item.output = String(error?.message ?? error);
      }
      item.file = null; // let the browser release the file
      render();
    }
    await app.refreshApps().catch(() => {});
  });
  draining = false;
  render();
}

async function act(kind, pkg) {
  if (!requireConnection(app)) return;
  const listed = app.userInstalled();
  if (kind === "uninstall") {
    const ok = await confirmDialog({
      titleKey: "apps.confirm.title", okKey: "apps.confirm.ok", danger: true,
      content: [h("p", { text: t("apps.confirm.body") }), h("p", {}, h("strong", {}, ltr(app.labelFor(pkg))), " ", ltr(pkg, "mono")),
        pkg === LAUNCHER.package ? note("warn", h("span", { text: t("apps.confirm.launcher") })) : null],
    });
    if (!ok) return;
  }
  await app.exclusive(async () => {
    const run = kind === "uninstall" ? uninstallApp : kind === "stop" ? forceStopApp : launchApp;
    const result = await run({ dev: app.dev, pkg, userInstalled: listed });
    if (result.ok) toast(t(`apps.done.${kind}`, { pkg }), "ok");
    else toast(t("apps.failed", { reply: result.output.slice(0, 160) || "?" }), "bad");
    if (kind === "uninstall") await app.refreshDevice();
  });
}

function queueRow(item) {
  const kind = item.status === "ok" ? "ok" : item.status === "failed" || item.status === "notApk" ? "bad" : "info";
  return h("li", { class: "inset" },
    h("div", { class: "queue-head" }, icon("file"), h("span", { class: "queue-name" }, ltr(item.name)), h("span", { class: "faint", text: formatBytes(item.size) }),
      h("span", { class: "spacer" }), h("span", { class: `badge badge-${kind}`, text: t(`apps.q.${item.status}`) })),
    item.status === "pushing" ? h("progress", { max: "1", value: String(item.progress) }) : null,
    item.status === "installing" ? h("progress", { max: "1" }) : null,
    rawDetails(item.command, item.output),
  );
}

function appRow(entry, listed) {
  const manageable = checkManageable(entry.name, listed).ok;
  const label = app.labelFor(entry.name);
  const action = (kind, iconName, key, danger = false) => h("button", { type: "button", class: `btn btn-small${danger ? " btn-danger" : ""}`, disabled: app.busy, on: { click: () => act(kind, entry.name) } }, icon(iconName), h("span", { text: t(key) }));
  return h("li", { class: "app-row inset" },
    h("span", { class: "app-glyph", text: (label.match(/[\p{L}\p{N}]/u) ?? ["?"])[0] }),
    h("div", {},
      h("div", { class: "app-name" }, ltr(label),
        entry.name === LAUNCHER.package ? h("span", { class: "badge badge-info", text: t("apps.thisLauncher") }) : null,
        entry.versionCode !== null ? h("span", { class: "faint", text: t("apps.build", { code: entry.versionCode }) }) : null),
      ltr(entry.name, "app-pkg mono"),
    ),
    manageable
      ? h("div", { class: "app-actions" }, action("launch", "play", "apps.launch"), action("stop", "stop", "apps.stop"), action("uninstall", "trash", "apps.uninstall", true))
      : h("div", { class: "app-actions" }, h("span", { class: "badge badge-warn", text: t("apps.protected") })),
  );
}

export function render() {
  queueBox.replaceChildren(...queue.map(queueRow));
  listTitle.textContent = t("apps.list.title", { n: app.userApps.length });
  document.getElementById("apps-refresh").disabled = !app.connected || app.busy;
  search.disabled = !app.connected;
  if (!app.connected) {
    listBox.replaceChildren(note("info", h("span", { text: t("common.connectFirst") })));
    return;
  }
  const listed = app.userInstalled();
  const shown = app.userApps.filter((entry) => !filter || entry.name.toLowerCase().includes(filter) || app.labelFor(entry.name).toLowerCase().includes(filter));
  if (app.userApps.length === 0) listBox.replaceChildren(h("p", { class: "muted", text: t("apps.empty") }));
  else if (shown.length === 0) listBox.replaceChildren(h("p", { class: "muted", text: t("apps.noMatch") }));
  else listBox.replaceChildren(h("ul", { class: "app-list" }, shown.map((entry) => appRow(entry, listed))));
}
