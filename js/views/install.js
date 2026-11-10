// Install / Update: one button, live checklist. The device work is core/pipeline.js installLauncher().
import { t } from "../i18n.js";
import { h, icon, ltr, note, clear, StepList, confirmDialog, toast, isApkFile } from "../ui.js";
import { installLauncher, INSTALL_STEPS, PipelineAbort } from "../core/pipeline.js";
import { LAUNCHER_GRANTS } from "../core/grant-plan.js";
import { sha256Hex, sameDigest, formatBytes } from "../core/version.js";
import { viewHead, panel, describeLauncherStep, requireConnection, abortMessage, shortGrantName } from "./shared.js";

let app;
let source = "published"; // "published" | "local"
let local = null; // {file, sha256: string|null}
let outcome = null; // {kind: "ok"|"bad"|"warn", text: () => string} — a function so it follows the language
let steps;
let sourceBox, button, outcomeBox, idleHint, fileInput;

export function init(root, appRef) {
  app = appRef;
  sourceBox = h("div", { class: "stack" });
  outcomeBox = h("div", { class: "stack" });
  idleHint = h("p", { class: "muted", i18n: "install.steps.idle" });
  const stepsBox = h("div", {});
  steps = new StepList(stepsBox, describeLauncherStep);
  button = h("button", { type: "button", class: "btn btn-primary btn-hero", on: { click: start } });
  fileInput = h("input", { type: "file", class: "file-input", accept: ".apk,application/vnd.android.package-archive", tabindex: "-1" });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) chooseLocal(file);
  });

  root.append(
    viewHead("install.title", "install.lead"),
    h("div", { class: "grid-2" },
      h("div", { class: "stack" },
        panel("install.source.title", "file", sourceBox, fileInput),
        panel("install.plan.title", "shield",
          h("ul", { class: "plan" },
            h("li", { i18n: "install.plan.install" }),
            h("li", { i18n: "install.plan.grants" }),
            h("li", { i18n: "install.plan.doze" }),
            h("li", { i18n: "install.plan.journal" }),
            h("li", { i18n: "install.plan.launch" }),
          ),
          h("p", { class: "faint", i18n: "install.plan.not" }),
        ),
      ),
      h("div", { class: "stack" },
        h("section", { class: "panel glass" },
          h("h2", {}, icon("pulse"), h("span", { i18n: "install.steps.title" })),
          h("div", { class: "hero-row" }, button),
          outcomeBox,
          idleHint,
          stepsBox,
        ),
      ),
    ),
  );
}

async function chooseLocal(file) {
  if (!isApkFile(file)) {
    toast(t("install.local.notApk"), "bad");
    return;
  }
  local = { file, sha256: null };
  source = "local";
  render();
  try {
    const digest = await sha256Hex(file);
    if (local && local.file === file) local.sha256 = digest;
  } catch {
    if (local && local.file === file) local = null;
  }
  render();
}

function publishedCard() {
  const release = app.release;
  const selectable = release.state === "published";
  const radio = h("input", { type: "radio", name: "apk-source", value: "published", disabled: !selectable, on: { change: () => { source = "published"; render(); } } });
  radio.checked = source === "published" && selectable;
  let body;
  if (release.state === "loading") body = h("p", { class: "muted", text: t("install.pub.loading") });
  else if (release.state === "none") body = note("info", h("span", { text: t("install.pub.none") }));
  else if (release.state === "invalid") body = note("warn", h("span", { text: t("install.pub.invalid", { problems: release.problems.join(", ") }) }));
  else {
    body = h("div", { class: "stack" },
      h("dl", { class: "kv" },
        h("dt", { text: t("install.pub.version") }), h("dd", {}, ltr(`${release.version} (${release.versionCode})`)),
        h("dt", { text: t("install.pub.size") }), h("dd", {}, ltr(formatBytes(release.size))),
        release.date ? [h("dt", { text: t("install.pub.date") }), h("dd", {}, ltr(release.date))] : null,
        h("dt", { text: t("install.pub.sha") }), h("dd", {}, ltr(release.sha256, "mono")),
      ),
      h("p", { class: "faint", text: t("install.pub.verifyNote") }),
    );
  }
  return h("label", { class: "source-option inset" }, h("h3", {}, radio, h("span", { text: t("install.source.published") })), body);
}

function localCard() {
  const radio = h("input", { type: "radio", name: "apk-source", value: "local", on: { change: () => { source = "local"; render(); } } });
  radio.checked = source === "local";
  const choose = h("button", { type: "button", class: "btn btn-small", disabled: app.busy, on: { click: () => fileInput.click() } }, icon("file"), h("span", { text: t("install.local.choose") }));
  let body;
  if (!local) body = h("p", { class: "muted", text: t("install.local.none") });
  else {
    const published = app.release.state === "published" ? app.release.sha256 : null;
    const verdict = local.sha256 === null
      ? h("span", { class: "badge", text: t("install.local.hashing") })
      : published && sameDigest(local.sha256, published)
        ? h("span", { class: "badge badge-ok", text: t("install.local.match") })
        : h("span", { class: "badge badge-warn", text: published ? t("install.local.nomatch") : t("install.local.unverifiable") });
    body = h("div", { class: "stack" },
      h("dl", { class: "kv" },
        h("dt", { text: t("install.pub.size") }), h("dd", {}, ltr(formatBytes(local.file.size))),
        h("dt", { text: t("install.pub.sha") }), h("dd", {}, ltr(local.sha256 ?? "…", "mono")),
      ),
      h("div", {}, h("strong", {}, ltr(local.file.name))),
      h("div", {}, verdict),
    );
  }
  return h("label", { class: "source-option inset" }, h("h3", {}, radio, h("span", { text: t("install.source.local") })), body, h("div", {}, choose));
}

function ready() {
  if (source === "published") return app.release.state === "published";
  return Boolean(local && local.sha256);
}

export function render() {
  if (source === "published" && app.release.state !== "published" && app.release.state !== "loading") source = "local";
  sourceBox.replaceChildren(h("div", { class: "source" }, publishedCard(), localCard()));
  clear(button).append(icon("download"), h("span", { text: app.launcher.installed ? t("install.buttonUpdate") : t("install.button") }));
  button.disabled = app.busy || !app.connected || !ready();
  idleHint.hidden = !steps.isEmpty;
  outcomeBox.replaceChildren(...[
    !app.connected ? note("info", h("span", { text: t("common.connectFirst") })) : null,
    outcome ? note(outcome.kind, h("span", { text: outcome.text() })) : null,
  ].filter(Boolean));
  steps.render();
}

async function downloadPublished(release, onProgress) {
  const response = await fetch(`apks/${encodeURIComponent(release.file)}`, { cache: "no-store" });
  if (!response.ok || !response.body) throw new PipelineAbort("fetch", "download-failed", `HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(received / release.size, 1));
  }
  return new Blob(chunks, { type: "application/vnd.android.package-archive" });
}

function planDialogContent(unverified) {
  return [
    unverified ? note("warn", h("span", { text: t("install.confirm.unverified") })) : null,
    h("ul", { class: "plan" },
      h("li", { text: t("install.plan.install") }),
      h("li", { text: t("install.plan.grants") }),
      h("li", { text: t("install.plan.doze") }),
      h("li", { text: t("install.plan.journal") }),
      h("li", { text: t("install.plan.launch") }),
    ),
    h("ul", { class: "plan" }, LAUNCHER_GRANTS.map(([, name]) => h("li", {}, ltr(shortGrantName(name), "mono"), ` — ${t(`why.${shortGrantName(name)}`)}`))),
    h("p", { class: "faint", text: t("install.plan.not") }),
  ];
}

async function start() {
  if (!requireConnection(app) || !ready()) return;
  const usingPublished = source === "published";
  const release = app.release;
  const publishedDigest = release.state === "published" ? release.sha256 : null;
  // A local file is verified only when it is byte-identical to the published release.
  const expected = usingPublished ? publishedDigest : publishedDigest && sameDigest(local.sha256, publishedDigest) ? publishedDigest : null;
  const confirmed = await confirmDialog({ titleKey: "install.confirm.title", okKey: "install.confirm.ok", content: planDialogContent(expected === null) });
  if (!confirmed) return;

  await app.exclusive(async () => {
    outcome = null;
    steps.reset(["fetch", ...INSTALL_STEPS]);
    render();
    try {
      let apk;
      if (usingPublished) {
        steps.update({ id: "fetch", status: "running", progress: 0 });
        try {
          const blob = await downloadPublished(release, (progress) => steps.update({ id: "fetch", status: "running", progress }));
          apk = { blob, name: release.file };
          steps.update({ id: "fetch", status: "pass", detail: "downloaded", output: `apks/${release.file} — ${blob.size} bytes` });
        } catch (error) {
          steps.update({ id: "fetch", status: "fail", output: String(error?.detail ?? error?.message ?? error) });
          throw error instanceof PipelineAbort ? error : new PipelineAbort("fetch", "download-failed", String(error?.message ?? error));
        }
      } else {
        apk = { blob: local.file, name: local.file.name };
        steps.update({ id: "fetch", status: "pass", detail: "local", output: `${local.file.name} — ${local.file.size} bytes` });
      }
      const result = await installLauncher({
        dev: app.dev, report: (step) => steps.update(step), apk, expectedSha256: expected,
        journalStore: app.journalStore, deviceKey: app.deviceKey,
      });
      const skipped = result.journal.grants.filter((grant) => !grant.ok).length;
      outcome = { kind: "ok", text: () => (skipped ? `${t("install.done")} ${t("install.doneSkips", { n: skipped })}` : t("install.done")) };
    } catch (error) {
      outcome = { kind: "bad", text: () => abortMessage(error) };
    } finally {
      await app.refreshDevice().catch(() => {});
    }
  });
  render();
}
