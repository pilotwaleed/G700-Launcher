// Tools: update check, repair, uninstall (with the journal report) and the diagnostics report.
import { t } from "../i18n.js";
import { h, icon, ltr, note, StepList, confirmDialog, copyText } from "../ui.js";
import { repairLauncher, uninstallLauncher, collectDiagnostics, REPAIR_STEPS, UNINSTALL_STEPS } from "../core/pipeline.js";
import { updateStatus } from "../core/version.js";
import { summarizeJournal } from "../core/journal.js";
import { buildDiagnosticsReport } from "../core/redact.js";
import { viewHead, panel, describeLauncherStep, requireConnection, abortMessage, shortGrantName } from "./shared.js";

let app;
let updateBox, repairSteps, uninstallSteps, repairOutcome, uninstallOutcome, keepData, includeSerial, reportBox, copyButton;
const buttons = {};
const outcome = { repair: null, uninstall: null }; // {kind, text: () => string, summary?}
let diagnostics = null; // collected data (kept so the serial option and the language can change without re-reading the car)

export function init(root, appRef) {
  app = appRef;
  updateBox = h("div", { class: "stack" });
  const repairBox = h("div", {});
  const uninstallBox = h("div", {});
  repairSteps = new StepList(repairBox, describeLauncherStep);
  uninstallSteps = new StepList(uninstallBox, describeLauncherStep);
  repairOutcome = h("div", {});
  uninstallOutcome = h("div", { class: "stack" });
  keepData = h("input", { type: "checkbox" });
  includeSerial = h("input", { type: "checkbox", on: { change: renderReport } });
  reportBox = h("pre", { class: "report" });
  buttons.check = h("button", { type: "button", class: "btn", on: { click: () => app.exclusive(async () => { await app.loadRelease(); await app.refreshDevice(); }) } }, icon("refresh"), h("span", { i18n: "tools.update.check" }));
  buttons.repair = h("button", { type: "button", class: "btn", on: { click: repair } }, icon("wrench"), h("span", { i18n: "tools.repair.button" }));
  buttons.uninstall = h("button", { type: "button", class: "btn btn-danger", on: { click: uninstall } }, icon("trash"), h("span", { i18n: "tools.uninstall.button" }));
  buttons.collect = h("button", { type: "button", class: "btn", on: { click: collect } }, icon("pulse"), h("span", { i18n: "tools.diag.collect" }));
  copyButton = h("button", { type: "button", class: "btn btn-quiet", on: { click: () => copyText(reportBox.textContent) } }, icon("copy"), h("span", { i18n: "tools.diag.copy" }));

  root.append(
    viewHead("tools.title", "tools.lead"),
    h("div", { class: "tool-grid" },
      panel("tools.update.title", "refresh", h("p", { class: "panel-lead", i18n: "tools.update.lead" }), updateBox, h("div", { class: "row" }, buttons.check)),
      panel("tools.repair.title", "wrench", h("p", { class: "panel-lead", i18n: "tools.repair.lead" }), h("div", { class: "row" }, buttons.repair), repairOutcome, repairBox),
      panel("tools.uninstall.title", "trash", h("p", { class: "panel-lead", i18n: "tools.uninstall.lead" }),
        h("label", { class: "check" }, keepData, h("span", { i18n: "tools.uninstall.keep" })),
        h("div", { class: "row" }, buttons.uninstall), uninstallOutcome, uninstallBox),
      panel("tools.diag.title", "pulse", h("p", { class: "panel-lead", i18n: "tools.diag.lead" }),
        h("label", { class: "check" }, includeSerial, h("span", { i18n: "tools.diag.include" })),
        h("div", { class: "row" }, buttons.collect, copyButton), reportBox),
    ),
  );
}

function journalReport(summary) {
  if (!summary.known) return note("info", h("span", { text: t("tools.uninstall.journal.unknown") }));
  return note("info",
    h("div", { text: t("tools.uninstall.journal.known") }),
    h("ul", { class: "plan" },
      summary.installedAt ? h("li", { text: t("tools.uninstall.journal.since", { date: summary.installedAt.slice(0, 10) }) }) : null,
      h("li", {}, t("tools.uninstall.journal.grants", { n: summary.grants.length }), summary.grants.length ? ": " : "", ltr(summary.grants.map((grant) => shortGrantName(grant.name)).join(", "), "mono")),
      summary.skipped.length ? h("li", {}, t("tools.uninstall.journal.skipped", { n: summary.skipped.length }), ": ", ltr(summary.skipped.map((grant) => shortGrantName(grant.name)).join(", "), "mono")) : null,
      summary.dozeWhitelist ? h("li", { text: t("tools.uninstall.journal.doze") }) : null,
      summary.notificationListener ? h("li", { text: t("tools.uninstall.journal.listener") }) : null,
    ),
  );
}

function renderReport() {
  if (!diagnostics) {
    reportBox.textContent = t("tools.diag.empty");
    copyButton.disabled = true;
    return;
  }
  const release = app.release;
  reportBox.textContent = buildDiagnosticsReport({
    ...diagnostics,
    includeSerial: includeSerial.checked,
    latest: release.versionCode ? { version: release.version, versionCode: release.versionCode, published: release.state === "published" } : null,
  });
  copyButton.disabled = false;
}

export function render() {
  const launcher = app.launcher;
  const release = app.release;
  const latestCode = release.state === "published" ? release.versionCode : null;
  const status = app.connected ? updateStatus(launcher.installed ? launcher.versionCode : null, latestCode) : null;
  updateBox.replaceChildren(
    h("dl", { class: "kv" },
      h("dt", { text: t("tools.update.installed") }),
      h("dd", {}, !app.connected ? "—" : launcher.installed ? ltr(`${launcher.versionName ?? "?"} (${launcher.versionCode ?? "?"})`) : t("connect.notInstalled")),
      h("dt", { text: t("tools.update.latest") }),
      h("dd", {}, release.state === "published" ? ltr(`${release.version} (${release.versionCode})`) : t("tools.update.none")),
    ),
    status ? note(status === "up-to-date" ? "ok" : status === "update-available" ? "warn" : "info", h("span", { text: t(`tools.update.status.${status}`) }))
      : note("info", h("span", { text: t("common.connectFirst") })),
  );
  const idle = app.connected && !app.busy;
  buttons.check.disabled = app.busy;
  buttons.repair.disabled = !idle || !launcher.installed;
  buttons.uninstall.disabled = !idle || !launcher.installed;
  buttons.collect.disabled = !idle;
  keepData.disabled = !idle;
  repairOutcome.replaceChildren(...(outcome.repair ? [note(outcome.repair.kind, h("span", { text: outcome.repair.text() }))] : []));
  uninstallOutcome.replaceChildren(...[
    outcome.uninstall ? note(outcome.uninstall.kind, h("span", { text: outcome.uninstall.text() })) : null,
    outcome.uninstall?.summary ? journalReport(outcome.uninstall.summary) : null,
  ].filter(Boolean));
  repairSteps.render();
  uninstallSteps.render();
  renderReport();
}

async function repair() {
  if (!requireConnection(app)) return;
  const ok = await confirmDialog({ titleKey: "tools.repair.confirm.title", okKey: "tools.repair.button", content: [h("p", { text: t("tools.repair.confirm.body") }), h("p", { class: "faint", text: t("install.plan.not") })] });
  if (!ok) return;
  await app.exclusive(async () => {
    outcome.repair = null;
    repairSteps.reset(REPAIR_STEPS);
    try {
      const { journal } = await repairLauncher({ dev: app.dev, report: (step) => repairSteps.update(step), journalStore: app.journalStore, deviceKey: app.deviceKey });
      const skipped = journal.grants.filter((grant) => !grant.ok).length;
      outcome.repair = { kind: "ok", text: () => (skipped ? `${t("tools.repair.done")} ${t("install.doneSkips", { n: skipped })}` : t("tools.repair.done")) };
    } catch (error) {
      outcome.repair = { kind: "bad", text: () => abortMessage(error) };
    } finally {
      await app.refreshDevice().catch(() => {});
    }
  });
  render();
}

async function uninstall() {
  if (!requireConnection(app)) return;
  const before = summarizeJournal(app.journalStore.entries(app.deviceKey));
  const ok = await confirmDialog({
    titleKey: "tools.uninstall.confirm.title", okKey: "tools.uninstall.confirm.ok", danger: true,
    content: [h("p", { text: t("tools.uninstall.confirm.body") }), journalReport(before), keepData.checked ? h("p", { class: "faint", text: t("tools.uninstall.keep") }) : null],
  });
  if (!ok) return;
  await app.exclusive(async () => {
    outcome.uninstall = null;
    uninstallSteps.reset(UNINSTALL_STEPS);
    try {
      const result = await uninstallLauncher({ dev: app.dev, report: (step) => uninstallSteps.update(step), journalStore: app.journalStore, deviceKey: app.deviceKey, keepData: keepData.checked });
      if (result.removed) outcome.uninstall = { kind: "ok", text: () => t("tools.uninstall.done"), summary: result.reversed };
      else if (uninstallSteps.count("fail")) outcome.uninstall = { kind: "bad", text: () => t("tools.uninstall.failed") };
      else outcome.uninstall = { kind: "info", text: () => t("tools.uninstall.nothing") };
    } catch (error) {
      outcome.uninstall = { kind: "bad", text: () => abortMessage(error) };
    } finally {
      await app.refreshDevice().catch(() => {});
    }
  });
  render();
}

async function collect() {
  if (!requireConnection(app)) return;
  await app.exclusive(async () => {
    diagnostics = { ...(await collectDiagnostics({ dev: app.dev })), serial: app.device?.serial ?? "", deviceSerials: app.deviceSerials };
  });
  render();
}
