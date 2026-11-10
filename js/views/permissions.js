// Fix permissions for any user-installed app: read what it declared, grant exactly that.
import { t } from "../i18n.js";
import { h, icon, ltr, note, rawDetails, confirmDialog } from "../ui.js";
import { fixAppPermissions } from "../core/pipeline.js";
import { checkManageable } from "../core/package-guard.js";
import { viewHead, panel, requireConnection } from "./shared.js";

const ALL = "*";
let app;
let select, devCheck, runButton, resultsBox, progressLabel;
let chosen = ALL;
let results = []; // {pkg, state: "running"|"done"|"notfound"|"refused"|"error", rows, untouched, reason, message}
let progress = null; // {i, n}

export function init(root, appRef) {
  app = appRef;
  select = h("select", { class: "select", id: "perms-app", on: { change: () => { chosen = select.value; render(); } } });
  devCheck = h("input", { type: "checkbox", id: "perms-dev" });
  runButton = h("button", { type: "button", class: "btn btn-primary", on: { click: run } });
  resultsBox = h("div", { class: "stack" });
  progressLabel = h("span", { class: "muted" });
  root.append(
    viewHead("perms.title", "perms.lead"),
    panel("perms.choose", "shield",
      h("div", { class: "stack" },
        h("label", { class: "field" }, h("span", { i18n: "perms.app" }), select),
        h("label", { class: "check" }, devCheck, h("span", {}, h("span", { i18n: "perms.dev" }), h("br"), h("span", { class: "faint", i18n: "perms.devHint" }))),
        h("div", { class: "row" }, runButton, progressLabel),
      ),
    ),
    h("section", { class: "panel glass" }, h("h2", {}, icon("check"), h("span", { i18n: "perms.results" })), resultsBox),
  );
}

function statusBadge(row) {
  const kind = row.status === "granted" || row.status === "already" ? "ok" : row.status === "failed" ? "bad" : "warn";
  const reason = row.reason ? ` — ${t(`perms.reason.${row.reason}`)}` : "";
  return h("span", { class: `badge badge-${kind}`, text: `${t(`perms.status.${row.status}`)}${reason}` });
}

function kindLabel(row) {
  return row.kind === "appop" ? t("perms.kind.appop", { op: row.op }) : t(`perms.kind.${row.kind}`);
}

function resultBlock(result, open) {
  const counts = { granted: 0, already: 0, skipped: 0, failed: 0, fixed: 0 };
  for (const row of result.rows ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const badges = h("span", { class: "counts" },
    result.state === "running" ? h("span", { class: "badge badge-info", text: t("status.running") }) : null,
    result.state === "refused" ? h("span", { class: "badge badge-bad", text: `${t("perms.status.refused")} — ${t(`perms.refused.${result.reason}`)}` }) : null,
    result.state === "error" ? h("span", { class: "badge badge-bad", text: t("perms.status.failed") }) : null,
    result.state === "notfound" ? h("span", { class: "badge badge-warn", text: t("perms.status.skipped") }) : null,
    result.state === "done" && result.rows.length === 0 ? h("span", { class: "badge", text: t("perms.nothing") }) : null,
    counts.granted ? h("span", { class: "badge badge-ok", text: `${t("perms.status.granted")} ${counts.granted}` }) : null,
    counts.already ? h("span", { class: "badge", text: `${t("perms.status.already")} ${counts.already}` }) : null,
    counts.skipped + counts.fixed ? h("span", { class: "badge badge-warn", text: `${t("perms.status.skipped")} ${counts.skipped + counts.fixed}` }) : null,
    counts.failed ? h("span", { class: "badge badge-bad", text: `${t("perms.status.failed")} ${counts.failed}` }) : null,
  );
  let body;
  if (result.state === "notfound") body = note("warn", h("span", { text: t("perms.notFound") }));
  else if (result.state === "error") body = note("bad", h("span", { text: t("err.generic", { message: result.message }) }));
  else if (result.state === "refused") body = null;
  else if (result.rows.length === 0 && result.state === "done") body = h("p", { class: "muted", text: t("perms.nothing") });
  else {
    body = h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", { text: t("perms.col.permission") }), h("th", { text: t("perms.col.type") }), h("th", { text: t("perms.col.result") }))),
      h("tbody", {}, result.rows.map((row) => h("tr", {},
        h("td", {}, ltr(row.permission, "mono")),
        h("td", { text: kindLabel(row) }),
        h("td", {}, statusBadge(row), rawDetails(row.command, row.output)),
      ))),
    );
  }
  const details = h("details", { class: "result-app inset", data: { pkg: result.pkg } },
    h("summary", {}, h("strong", {}, ltr(app.labelFor(result.pkg))), ltr(result.pkg, "app-pkg mono"), badges),
    body,
    result.state === "done" && result.untouched ? h("p", { class: "faint", text: t("perms.untouched", { n: result.untouched }) }) : null,
  );
  details.open = open;
  return details;
}

export function render() {
  const apps = app.userApps;
  const options = [h("option", { value: ALL, text: t("perms.all", { n: apps.length }) }), ...apps.map((a) => h("option", { value: a.name, text: `${app.labelFor(a.name)} — ${a.name}` }))];
  if (chosen !== ALL && !apps.some((a) => a.name === chosen)) chosen = ALL;
  select.replaceChildren(...options);
  select.value = chosen;
  select.disabled = !app.connected || app.busy;
  devCheck.disabled = chosen === ALL || app.busy;
  if (chosen === ALL) devCheck.checked = false;
  runButton.replaceChildren(icon("shield"), h("span", { text: t("perms.run") }));
  runButton.disabled = !app.connected || app.busy || apps.length === 0;
  progressLabel.textContent = progress ? t("perms.progress", progress) : "";

  const openPkgs = new Set([...resultsBox.querySelectorAll("details[data-pkg]")].filter((d) => d.open).map((d) => d.dataset.pkg));
  if (!app.connected) resultsBox.replaceChildren(note("info", h("span", { text: t("common.connectFirst") })));
  else if (apps.length === 0) resultsBox.replaceChildren(h("p", { class: "muted", text: t("perms.empty") }));
  else resultsBox.replaceChildren(...results.map((result) => resultBlock(result, results.length === 1 || openPkgs.has(result.pkg))));
}

async function run() {
  if (!requireConnection(app)) return;
  const all = chosen === ALL;
  const targets = all ? app.userApps.map((a) => a.name) : [chosen];
  const includeDevelopment = !all && devCheck.checked;
  if (all) {
    const ok = await confirmDialog({ titleKey: "perms.confirmAll.title", okKey: "perms.confirmAll.ok", content: [h("p", { text: t("perms.confirmAll.body", { n: targets.length }) })] });
    if (!ok) return;
  }
  await app.exclusive(async () => {
    results = [];
    const listed = app.userInstalled();
    for (let i = 0; i < targets.length; i++) {
      const pkg = targets[i];
      progress = { i: i + 1, n: targets.length };
      const verdict = checkManageable(pkg, listed);
      if (!verdict.ok) {
        results.push({ pkg, state: "refused", reason: verdict.reason, rows: [], untouched: 0 });
        render();
        continue;
      }
      const entry = { pkg, state: "running", rows: [], untouched: 0 };
      results.push(entry);
      render();
      try {
        const done = await fixAppPermissions({
          dev: app.dev, pkg, userInstalled: listed, userId: app.device?.currentUser ?? 0, includeDevelopment,
          onRow: (row) => { entry.rows.push(row); render(); },
        });
        entry.rows = done.rows;
        entry.untouched = done.untouched;
        entry.state = done.found ? "done" : "notfound";
      } catch (error) {
        entry.state = "error";
        entry.message = String(error?.message ?? error).slice(0, 200);
        if (!app.connected) break;
      }
      render();
    }
    progress = null;
  });
  render();
}
