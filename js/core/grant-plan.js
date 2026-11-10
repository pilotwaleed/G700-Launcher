// Grant lists and plans.
//  - LAUNCHER_GRANTS mirrors GRANTS in tools/g700ctl.py line for line (same order, same names, same reasons).
//    If either changes, change the other in the same commit; test/pipeline.test.js pins the list.
//  - buildGrantPlan() is the "fix permissions for any app" planner: it only ever plans a grant for a
//    permission the app itself requested in its manifest.
import { cmd, isPermissionName } from "./tokens.js";
import { runtimeStatesFor } from "./dumpsys-package.js";

export const LAUNCHER = Object.freeze({
  package: "com.g700studio",
  activity: "com.g700studio/.MainActivity",
  mediaListener: "com.g700studio/com.g700studio.platform.media.MediaListenerService",
  filesDir: "/sdcard/Android/data/com.g700studio/files",
  deviceJournal: "/sdcard/Android/data/com.g700studio/files/install-journal.json",
  killSwitch: "/sdcard/Android/data/com.g700studio/files/noboot",
  tempApk: "/data/local/tmp/g700wi-launcher.apk",
});

/** (kind, name, why) — identical to tools/g700ctl.py GRANTS. */
export const LAUNCHER_GRANTS = Object.freeze([
  ["appops", "SYSTEM_ALERT_WINDOW", "quick-access handle (the stock launcher hides sideloaded apps)"],
  ["appops", "REQUEST_INSTALL_PACKAGES", "install apps from verified publishers and self-update"],
  ["appops", "GET_USAGE_STATS", "know which app is in front"],
  ["appops", "PROJECT_MEDIA", "mirror the centre screen to an identified screen"],
  ["appops", "WRITE_SETTINGS", "brightness slider in the Control Centre"],
  ["pm", "android.permission.WRITE_SECURE_SETTINGS", "helper link re-enables its own services after boot"],
  ["pm", "android.permission.ACCESS_FINE_LOCATION", "weather and prayer times for where the car is (optional)"],
  ["pm", "android.permission.ACCESS_COARSE_LOCATION", "weather and prayer times for where the car is (optional)"],
  ["pm", "android.permission.POST_NOTIFICATIONS", "service notifications with Stop actions"],
  ["pm", "android.car.permission.CAR_ENERGY", "battery, fuel, range widget"],
  ["pm", "android.car.permission.CAR_POWERTRAIN", "gear/parking brake as a parked cross-check"],
  ["pm", "android.car.permission.CAR_EXTERIOR_ENVIRONMENT", "outside temperature"],
  ["pm", "android.car.permission.CAR_INFO", "vehicle info"],
  ["notification", LAUNCHER.mediaListener, "Now Playing widget (media sessions)"],
].map((row) => Object.freeze(row)));

/** One shell command per launcher grant, built exactly as g700ctl.py apply_grants() builds them. */
export function launcherGrantCommands() {
  return LAUNCHER_GRANTS.map(([kind, name, why]) => {
    let command;
    if (kind === "appops") command = cmd.appopsSet(LAUNCHER.package, name);
    else if (kind === "pm") command = cmd.pmGrant(LAUNCHER.package, name);
    else command = cmd.allowListener(name);
    return { kind, name, why, command };
  });
}

/** g700ctl.py: ok = rc == 0 and "Exception" not in out and "not a changeable" not in out. Anything else is a skip, never an abort. */
export function launcherGrantOk({ exitCode, output }) {
  const text = String(output || "");
  return exitCode === 0 && !text.includes("Exception") && !text.includes("not a changeable");
}

// ------------------------------------------------------------------ any-app planner

/** Special access the car's Settings app cannot reach: manifest permission → app-op set with `appops set <pkg> <op> allow`. */
export const APP_OP_FOR_PERMISSION = Object.freeze({
  "android.permission.SYSTEM_ALERT_WINDOW": "SYSTEM_ALERT_WINDOW",
  "android.permission.REQUEST_INSTALL_PACKAGES": "REQUEST_INSTALL_PACKAGES",
  "android.permission.PACKAGE_USAGE_STATS": "GET_USAGE_STATS",
  "android.permission.WRITE_SETTINGS": "WRITE_SETTINGS",
  "android.permission.MANAGE_EXTERNAL_STORAGE": "MANAGE_EXTERNAL_STORAGE",
  "android.permission.SCHEDULE_EXACT_ALARM": "SCHEDULE_EXACT_ALARM",
  "android.permission.USE_FULL_SCREEN_INTENT": "USE_FULL_SCREEN_INTENT",
  "android.permission.TURN_SCREEN_ON": "TURN_SCREEN_ON",
});

/** Declaring this asks to be exempt from battery optimisation; the matching action is the doze allow-list. */
export const DOZE_PERMISSION = "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS";

/** Developer-level permissions `pm grant` can give. Off unless the owner ticks the option, and never in "all apps" mode. */
export const DEVELOPMENT_PERMISSIONS = Object.freeze([
  "android.permission.WRITE_SECURE_SETTINGS",
  "android.permission.READ_LOGS",
  "android.permission.DUMP",
]);

/** Used only when the car's dump has no runtime-permission section for the app (then we cannot see states). */
export const KNOWN_RUNTIME_PERMISSIONS = Object.freeze([
  "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "ACCESS_MEDIA_LOCATION",
  "RECORD_AUDIO", "CAMERA", "POST_NOTIFICATIONS", "BODY_SENSORS", "ACTIVITY_RECOGNITION",
  "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_MEDIA_AUDIO",
  "READ_MEDIA_VISUAL_USER_SELECTED", "READ_CONTACTS", "WRITE_CONTACTS", "GET_ACCOUNTS", "READ_CALENDAR", "WRITE_CALENDAR",
  "READ_PHONE_STATE", "READ_PHONE_NUMBERS", "CALL_PHONE", "ANSWER_PHONE_CALLS", "READ_CALL_LOG", "WRITE_CALL_LOG",
  "SEND_SMS", "RECEIVE_SMS", "READ_SMS", "BLUETOOTH_CONNECT", "BLUETOOTH_SCAN", "BLUETOOTH_ADVERTISE",
  "NEARBY_WIFI_DEVICES", "UWB_RANGING",
].map((name) => `android.permission.${name}`));

const FIXED_FLAGS = ["SYSTEM_FIXED", "POLICY_FIXED"];

/**
 * @param parsed result of parseDumpsysPackage()
 * @param {{userId?: number, includeDevelopment?: boolean}} options
 * @returns {{package: string, items: Array, untouched: number}}
 *   items: {permission, kind: "runtime"|"appop"|"doze"|"development", state: "todo"|"already"|"fixed", command: string|null, op?: string}
 */
export function buildGrantPlan(parsed, options = {}) {
  const userId = options.userId ?? 0;
  const includeDevelopment = options.includeDevelopment === true;
  const pkg = parsed.packageName;
  const runtime = runtimeStatesFor(parsed, userId);
  const haveRuntimeSection = Object.keys(runtime).length > 0;
  const items = [];
  let untouched = 0;

  for (const permission of parsed.requested) {
    if (!isPermissionName(permission)) continue;
    const op = APP_OP_FOR_PERMISSION[permission];
    if (op) {
      items.push({ permission, kind: "appop", op, state: "todo", command: cmd.appopsSet(pkg, op) });
      continue;
    }
    if (permission === DOZE_PERMISSION) {
      items.push({ permission, kind: "doze", state: "todo", command: cmd.dozeAdd(pkg) });
      continue;
    }
    if (DEVELOPMENT_PERMISSIONS.includes(permission)) {
      if (!includeDevelopment) { untouched++; continue; }
      const already = parsed.install[permission] === true || runtime[permission]?.granted === true;
      items.push({ permission, kind: "development", state: already ? "already" : "todo", command: already ? null : cmd.pmGrant(pkg, permission, userId) });
      continue;
    }
    const state = runtime[permission];
    if (state) {
      if (state.granted) items.push({ permission, kind: "runtime", state: "already", command: null });
      else if (state.flags.some((flag) => FIXED_FLAGS.includes(flag))) items.push({ permission, kind: "runtime", state: "fixed", command: null });
      else items.push({ permission, kind: "runtime", state: "todo", command: cmd.pmGrant(pkg, permission, userId) });
      continue;
    }
    if (!haveRuntimeSection && KNOWN_RUNTIME_PERMISSIONS.includes(permission)) {
      items.push({ permission, kind: "runtime", state: "todo", command: cmd.pmGrant(pkg, permission, userId) });
      continue;
    }
    untouched++; // normal / signature permissions: granted at install or not grantable — nothing to do
  }
  return { package: pkg, items, untouched };
}

/**
 * Outcome of one planned command.
 * @returns {{status: "granted"|"skipped"|"failed", reason: string|null}}
 */
export function classifyGrantOutcome({ exitCode, output }) {
  const text = String(output || "");
  if (/not a changeable permission type/i.test(text)) return { status: "skipped", reason: "not-changeable" };
  if (/Unknown permission|Unknown operation string|No such permission/i.test(text)) return { status: "skipped", reason: "not-defined" };
  if (/has not requested permission/i.test(text)) return { status: "skipped", reason: "not-requested" };
  if (/Unknown package|not found|is not installed/i.test(text) && exitCode !== 0) return { status: "failed", reason: "no-package" };
  if (exitCode !== 0 || /Exception|^Error:/im.test(text)) return { status: "failed", reason: "error" };
  return { status: "granted", reason: null };
}
