// Device pipelines. They talk to an abstract device ({shell, push}) so they can be unit-tested with a fake car.
// install / repair / uninstall mirror tools/g700ctl.py cmd_install / cmd_repair / cmd_uninstall step for step;
// test/pipeline.test.js pins the exact command sequence.
//
// Device interface:
//   shell(command: string) -> Promise<{output: string, exitCode: number|null}>
//   push(devicePath: string, blob: Blob, onProgress?: (sent, total) => void) -> Promise<void>
import { cmd } from "./tokens.js";
import { assertManageable } from "./package-guard.js";
import { parseDumpsysPackage, parsePackageList, listContainsPackage, parseCurrentUser, runtimeStatesFor } from "./dumpsys-package.js";
import { LAUNCHER, LAUNCHER_GRANTS, launcherGrantCommands, launcherGrantOk, buildGrantPlan, classifyGrantOutcome } from "./grant-plan.js";
import { sha256Hex, sameDigest } from "./version.js";
import { summarizeJournal } from "./journal.js";
import { summarizeDisplays } from "./redact.js";

export class PipelineAbort extends Error {
  constructor(stepId, reason, detail = "") {
    super(`${stepId}: ${reason}`);
    this.name = "PipelineAbort";
    this.stepId = stepId;
    this.reason = reason;
    this.detail = detail;
  }
}

const clip = (text, max = 200) => String(text ?? "").slice(0, max);
const nowIso = (now) => (now ? now() : new Date()).toISOString();

/** Runs one shell step and reports running → pass/skip. A non-zero exit is a skip (as g700ctl ignores it), never an abort. */
async function shellStep(dev, report, id, command, extra = {}) {
  report({ id, status: "running", command, ...extra });
  const reply = await dev.shell(command);
  const ok = reply.exitCode === 0 || reply.exitCode === null;
  report({ id, status: ok ? "pass" : "skip", command, output: reply.output, ...extra });
  return reply;
}

export async function readLauncherState(dev) {
  const listed = await dev.shell(cmd.listPackage(LAUNCHER.package));
  if (!listContainsPackage(listed.output, LAUNCHER.package)) return { installed: false, versionName: null, versionCode: null, parsed: null };
  const dump = await dev.shell(cmd.dumpsysPackage(LAUNCHER.package));
  const parsed = parseDumpsysPackage(dump.output, LAUNCHER.package);
  return { installed: true, versionName: parsed.versionName, versionCode: parsed.versionCode, parsed };
}

const versionLabel = (state) => (state.installed ? `versionCode=${state.versionCode ?? "?"} versionName=${state.versionName ?? "?"}` : null);

/** g700ctl.py apply_grants(): every grant in order, ok or skip, then the doze allow-list. */
async function applyLauncherGrants(dev, report, journal) {
  const results = [];
  for (const grant of launcherGrantCommands()) {
    const id = `grant:${grant.name}`;
    report({ id, group: "grants", status: "running", command: grant.command, grant });
    const reply = await dev.shell(grant.command);
    const ok = launcherGrantOk(reply);
    results.push({ kind: grant.kind, name: grant.name, why: grant.why, ok, output: clip(reply.output) });
    report({ id, group: "grants", status: ok ? "pass" : "skip", command: grant.command, output: reply.output, grant });
  }
  journal.grants = results;
  await shellStep(dev, report, "doze", cmd.dozeAdd(LAUNCHER.package));
  journal.dozeWhitelist = true;
}

/** The ordered step ids of each pipeline, so the UI can draw the checklist before anything runs. */
export const INSTALL_STEPS = Object.freeze([
  "verify", "existing", "push", "install", "confirm",
  ...LAUNCHER_GRANTS.map(([, name]) => `grant:${name}`),
  "doze", "killswitch", "journal-local", "journal-device", "launch",
]);
export const REPAIR_STEPS = Object.freeze([
  "existing", ...LAUNCHER_GRANTS.map(([, name]) => `grant:${name}`), "doze", "killswitch", "journal-local", "launch",
]);
export const UNINSTALL_STEPS = Object.freeze(["existing", "force-stop", "listener", "doze-remove", "uninstall", "journal-local"]);

/**
 * Install or update the launcher.
 * @param options {dev, report, apk: {blob: Blob, name: string}, expectedSha256: string|null, journalStore, deviceKey, now?}
 *   expectedSha256 = the published digest from latest.json; null only for a local APK the owner explicitly accepted.
 */
export async function installLauncher({ dev, report, apk, expectedSha256, journalStore, deviceKey, now }) {
  // 1. verify the artifact before anything touches the car
  report({ id: "verify", status: "running" });
  const digest = await sha256Hex(apk.blob);
  const artifact = { file: clip(apk.name, 120), sha256: digest, size: apk.blob.size, verifiedAgainst: expectedSha256 ? "latest.json" : "none" };
  if (expectedSha256 && !sameDigest(digest, expectedSha256)) {
    report({ id: "verify", status: "fail", output: `expected ${expectedSha256}\nactual   ${digest}`, detail: "mismatch" });
    throw new PipelineAbort("verify", "sha256-mismatch", digest);
  }
  report({ id: "verify", status: expectedSha256 ? "pass" : "skip", output: `sha256 ${digest}`, detail: expectedSha256 ? "verified" : "unverified-local" });

  // 2. is this an update?
  report({ id: "existing", status: "running", command: cmd.listPackage(LAUNCHER.package) });
  const before = await readLauncherState(dev);
  report({ id: "existing", status: "pass", command: cmd.listPackage(LAUNCHER.package), output: before.installed ? versionLabel(before) : "not installed", detail: before.installed ? "update" : "fresh" });
  const journal = { tool: "web-installer install", at: nowIso(now), artifact, wasInstalled: before.installed, previousVersion: versionLabel(before) };

  // 3. push, 4. pm install -r (keeps app data on update), always remove the temporary copy
  report({ id: "push", status: "running", progress: 0 });
  try {
    await dev.push(LAUNCHER.tempApk, apk.blob, (sent, total) => report({ id: "push", status: "running", progress: total ? sent / total : 0 }));
  } catch (error) {
    report({ id: "push", status: "fail", output: String(error?.message ?? error) });
    throw new PipelineAbort("push", "push-failed", String(error?.message ?? error));
  }
  report({ id: "push", status: "pass", progress: 1, output: `${apk.blob.size} bytes -> ${LAUNCHER.tempApk}` });

  const installCommand = cmd.pmInstall(LAUNCHER.tempApk);
  report({ id: "install", status: "running", command: installCommand });
  const installed = await dev.shell(installCommand);
  await dev.shell(cmd.rmForce(LAUNCHER.tempApk));
  if (!(installed.exitCode === 0 || installed.exitCode === null) || !installed.output.includes("Success")) {
    report({ id: "install", status: "fail", command: installCommand, output: installed.output });
    throw new PipelineAbort("install", "install-failed", installed.output);
  }
  report({ id: "install", status: "pass", command: installCommand, output: installed.output });

  // 5. the APK must have been the launcher; otherwise stop before granting anything
  report({ id: "confirm", status: "running", command: cmd.listPackage(LAUNCHER.package) });
  const after = await readLauncherState(dev);
  if (!after.installed) {
    report({ id: "confirm", status: "fail", command: cmd.listPackage(LAUNCHER.package), output: "package not present after install" });
    throw new PipelineAbort("confirm", "not-the-launcher");
  }
  report({ id: "confirm", status: "pass", command: cmd.listPackage(LAUNCHER.package), output: versionLabel(after) });
  journal.installed = true;
  journal.installedVersion = versionLabel(after);

  // 6–7. grants and doze allow-list, 8. clear the kill switch
  await applyLauncherGrants(dev, report, journal);
  await shellStep(dev, report, "killswitch", cmd.rmForce(LAUNCHER.killSwitch));

  // 9. journal here and on the car
  const stored = journalStore.append(deviceKey, journal);
  report({ id: "journal-local", status: stored ? "pass" : "skip", detail: stored ? "stored" : "memory-only" });
  report({ id: "journal-device", status: "running", command: cmd.mkdirP(LAUNCHER.filesDir) });
  try {
    const made = await dev.shell(cmd.mkdirP(LAUNCHER.filesDir));
    await dev.push(LAUNCHER.deviceJournal, new Blob([JSON.stringify(journal)], { type: "application/json" }));
    report({ id: "journal-device", status: "pass", command: cmd.mkdirP(LAUNCHER.filesDir), output: `${made.output}\n-> ${LAUNCHER.deviceJournal}`.trim() });
  } catch (error) {
    report({ id: "journal-device", status: "skip", command: cmd.mkdirP(LAUNCHER.filesDir), output: String(error?.message ?? error) });
  }

  // 10. launch
  await shellStep(dev, report, "launch", cmd.amStart(LAUNCHER.activity));
  return { journal, before, after };
}

/** Re-apply the grants. No reinstall, no data loss. */
export async function repairLauncher({ dev, report, journalStore, deviceKey, now }) {
  report({ id: "existing", status: "running", command: cmd.listPackage(LAUNCHER.package) });
  const state = await readLauncherState(dev);
  if (!state.installed) {
    report({ id: "existing", status: "fail", command: cmd.listPackage(LAUNCHER.package), output: "not installed" });
    throw new PipelineAbort("existing", "not-installed");
  }
  report({ id: "existing", status: "pass", command: cmd.listPackage(LAUNCHER.package), output: versionLabel(state) });
  const journal = { tool: "web-installer repair", at: nowIso(now) };
  await applyLauncherGrants(dev, report, journal);
  await shellStep(dev, report, "killswitch", cmd.rmForce(LAUNCHER.killSwitch));
  const stored = journalStore.append(deviceKey, journal);
  report({ id: "journal-local", status: stored ? "pass" : "skip", detail: stored ? "stored" : "memory-only" });
  await shellStep(dev, report, "launch", cmd.amStart(LAUNCHER.activity));
  return { journal };
}

/** Remove the launcher and what the installer added. Returns what the local journal said had been changed. */
export async function uninstallLauncher({ dev, report, journalStore, deviceKey, keepData = false, now }) {
  const reversed = summarizeJournal(journalStore.entries(deviceKey));
  report({ id: "existing", status: "running", command: cmd.listPackage(LAUNCHER.package) });
  const state = await readLauncherState(dev);
  if (!state.installed) {
    report({ id: "existing", status: "skip", command: cmd.listPackage(LAUNCHER.package), output: "not installed; nothing to remove" });
    return { removed: false, reversed };
  }
  report({ id: "existing", status: "pass", command: cmd.listPackage(LAUNCHER.package), output: versionLabel(state) });
  await shellStep(dev, report, "force-stop", cmd.forceStop(LAUNCHER.package));
  await shellStep(dev, report, "listener", cmd.disallowListener(LAUNCHER.mediaListener));
  await shellStep(dev, report, "doze-remove", cmd.dozeRemove(LAUNCHER.package));
  const command = cmd.pmUninstall(LAUNCHER.package, keepData);
  report({ id: "uninstall", status: "running", command });
  const reply = await dev.shell(command);
  const removed = reply.output.includes("Success");
  report({ id: "uninstall", status: removed ? "pass" : "fail", command, output: reply.output });
  const stored = journalStore.append(deviceKey, { tool: "web-installer uninstall", at: nowIso(now), keepData, result: clip(reply.output) });
  report({ id: "journal-local", status: stored ? "pass" : "skip", detail: stored ? "stored" : "memory-only" });
  return { removed, reversed };
}

// ------------------------------------------------------------------ any app

export async function listUserApps(dev) {
  const reply = await dev.shell(cmd.listThirdParty());
  return parsePackageList(reply.output);
}

export async function readCurrentUser(dev) {
  return parseCurrentUser((await dev.shell(cmd.currentUser())).output);
}

/**
 * Grant what one user-installed app declared. Never grants anything it did not request.
 * @returns {{package, found: boolean, versionName, rows: Array<{permission, kind, op, status, reason, command, output}>, untouched: number}}
 *   status: "granted" | "already" | "fixed" | "skipped" | "failed"
 */
export async function fixAppPermissions({ dev, pkg, userInstalled, userId = 0, includeDevelopment = false, onRow }) {
  assertManageable(pkg, userInstalled);
  const dump = await dev.shell(cmd.dumpsysPackage(pkg));
  const parsed = parseDumpsysPackage(dump.output, pkg);
  if (!parsed.found) return { package: pkg, found: false, versionName: null, rows: [], untouched: 0 };
  const plan = buildGrantPlan(parsed, { userId, includeDevelopment });
  const rows = [];
  for (const item of plan.items) {
    const row = { permission: item.permission, kind: item.kind, op: item.op ?? null, status: item.state, reason: null, command: item.command, output: "" };
    if (item.state === "todo") {
      const reply = await dev.shell(item.command);
      const outcome = classifyGrantOutcome(reply);
      row.status = outcome.status;
      row.reason = outcome.reason;
      row.output = reply.output;
    }
    rows.push(row);
    onRow?.(row);
  }
  return { package: pkg, found: true, versionName: parsed.versionName, rows, untouched: plan.untouched };
}

/** Push one APK under a fixed temporary name (the file's own name is never sent to the car) and install it. */
export async function installApk({ dev, blob, slot = 0, onProgress }) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 999) throw new Error("bad slot");
  const path = `/data/local/tmp/g700wi-app-${slot}.apk`;
  await dev.push(path, blob, onProgress);
  const command = cmd.pmInstall(path);
  const reply = await dev.shell(command);
  await dev.shell(cmd.rmForce(path));
  return { ok: (reply.exitCode === 0 || reply.exitCode === null) && reply.output.includes("Success"), command, output: reply.output };
}

export async function uninstallApp({ dev, pkg, userInstalled }) {
  assertManageable(pkg, userInstalled);
  const command = cmd.pmUninstall(pkg);
  const reply = await dev.shell(command);
  return { ok: reply.output.includes("Success"), command, output: reply.output };
}

export async function forceStopApp({ dev, pkg, userInstalled }) {
  assertManageable(pkg, userInstalled);
  const command = cmd.forceStop(pkg);
  const reply = await dev.shell(command);
  return { ok: reply.exitCode === 0 || reply.exitCode === null, command, output: reply.output };
}

export async function launchApp({ dev, pkg, userInstalled }) {
  assertManageable(pkg, userInstalled);
  const command = cmd.launch(pkg);
  const reply = await dev.shell(command);
  return { ok: (reply.exitCode === 0 || reply.exitCode === null) && !/No activities found|monkey aborted/i.test(reply.output), command, output: reply.output };
}

// ------------------------------------------------------------------ read-only

export const DEVICE_PROPS = Object.freeze(["ro.product.model", "ro.product.manufacturer", "ro.build.version.release", "ro.build.version.sdk", "ro.build.display.id"]);
export const DIAGNOSTIC_PROPS = Object.freeze([
  "ro.build.fingerprint", "ro.build.display.id", "ro.build.version.sdk", "ro.build.version.release", "ro.product.model",
  "ro.product.manufacturer", "ro.board.platform", "ro.hardware", "ro.adb.secure", "ro.debuggable",
]);

export async function readProps(dev, keys) {
  const props = {};
  for (const key of keys) props[key] = clip((await dev.shell(cmd.getprop(key))).output.trim(), 300);
  return props;
}

/** Everything the diagnostics report needs. Read-only: getprop, dumpsys, pm list, appops get. */
export async function collectDiagnostics({ dev, now }) {
  const props = await readProps(dev, DIAGNOSTIC_PROPS);
  const currentUser = await readCurrentUser(dev);
  const displays = summarizeDisplays((await dev.shell(cmd.dumpsysDisplay())).output);
  const state = await readLauncherState(dev);
  const grants = [];
  if (state.installed) {
    const runtime = runtimeStatesFor(state.parsed, currentUser);
    for (const [kind, name] of LAUNCHER_GRANTS) {
      if (kind === "appops") {
        const reply = await dev.shell(cmd.appopsGet(LAUNCHER.package, name));
        const mode = /:\s*(allow|deny|ignore|default|foreground|ask)\b/.exec(reply.output);
        grants.push({ kind, name, state: mode ? mode[1] : /No operations/i.test(reply.output) ? "default" : "unknown" });
      } else if (kind === "pm") {
        const granted = runtime[name]?.granted === true || state.parsed.install[name] === true;
        const requested = state.parsed.requested.includes(name);
        grants.push({ kind, name, state: granted ? "granted" : requested ? "not granted" : "not requested by this build" });
      } else {
        grants.push({ kind, name, state: "not read (needs a settings query this site does not issue)" });
      }
    }
  }
  const thirdPartyCount = (await listUserApps(dev)).length;
  return {
    generatedAt: nowIso(now),
    props,
    currentUser,
    displays,
    launcher: { installed: state.installed, versionName: state.versionName, versionCode: state.versionCode },
    grants,
    thirdPartyCount,
  };
}
