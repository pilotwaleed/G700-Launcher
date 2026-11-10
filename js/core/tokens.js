// Validated tokens and the only shell-command builders this site uses.
// Rule: nothing read from the car, a file name or a JSON file reaches a shell command unless it has
// passed one of the validators below. Commands are plain words — no quoting, pipes or substitutions.

export class TokenError extends Error {
  constructor(kind, value) {
    super(`invalid ${kind}: ${String(value).slice(0, 80)}`);
    this.name = "TokenError";
    this.kind = kind;
  }
}

export const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
export const PERMISSION_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
export const APPOP_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const COMPONENT_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\/\.?[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
export const PROP_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,90}$/;
export const DEVICE_PATH_RE = /^\/(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*$/;
export const APK_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.apk$/;

function check(kind, re, value, maxLength) {
  if (typeof value !== "string" || value.length > maxLength || !re.test(value)) throw new TokenError(kind, value);
  return value;
}

export const isPackageName = (v) => typeof v === "string" && v.length <= 255 && PACKAGE_RE.test(v);
export const isPermissionName = (v) => typeof v === "string" && v.length <= 255 && PERMISSION_RE.test(v);
export const assertPackage = (v) => check("package name", PACKAGE_RE, v, 255);
export const assertPermission = (v) => check("permission name", PERMISSION_RE, v, 255);
export const assertAppOp = (v) => check("app-op name", APPOP_RE, v, 64);
export const assertComponent = (v) => check("component name", COMPONENT_RE, v, 400);
export const assertProp = (v) => check("property key", PROP_RE, v, 91);
export const assertDevicePath = (v) => {
  check("device path", DEVICE_PATH_RE, v, 300);
  if (v.split("/").some((part) => part === "." || part === "..")) throw new TokenError("device path", v);
  return v;
};
export function assertUserId(v) {
  if (!Number.isInteger(v) || v < 0 || v > 9999) throw new TokenError("user id", v);
  return v;
}

/** Only these characters may appear in a command sent to the car. No quotes, pipes, `;`, `$`, `&`, `<`, `>` or backticks. */
const SAFE_COMMAND_RE = /^[A-Za-z0-9 _.\/+:-]+$/;

/** Fixed allow-list (ADR-005 style): a command must begin with one of these, or it is never sent. */
export const ALLOWED_COMMAND_HEADS = [
  "getprop ",
  "am get-current-user",
  "pm list packages",
  "dumpsys package ",
  "dumpsys display",
  "dumpsys deviceidle whitelist ",
  "pm install -r ",
  "pm uninstall ",
  "pm grant ",
  "appops set ",
  "appops get ",
  "cmd notification allow_listener ",
  "cmd notification disallow_listener ",
  "rm -f ",
  "mkdir -p ",
  "am start -n ",
  "am force-stop ",
  "monkey -p ",
];

/** The only places this site deletes from or creates directories in. */
export const WRITABLE_PATH_PREFIXES = ["/data/local/tmp/g700wi-", "/sdcard/Android/data/com.g700studio/files"];

/** Operations this site never issues; listed so a reviewer (and a unit test) can check. */
const FORBIDDEN_COMMAND_RES = [
  /^am\s+crash\b/,
  /^pm\s+(?:disable|disable-user|disable-until-used|hide|suspend|clear)\b/,
  /^cmd\s+package\s+(?:disable|suspend|clear)\b/,
  /^(?:reboot|setprop|su|svc|wm|settings)\b/,
  /\/(?:adbkey|adb_keys)\b/,
];

/** Final gate used by the ADB session. Throws rather than sending anything unexpected. */
export function assertSafeCommand(command) {
  if (typeof command !== "string" || command.length === 0 || command.length > 600 || !SAFE_COMMAND_RE.test(command)) {
    throw new TokenError("shell command", command);
  }
  for (const re of FORBIDDEN_COMMAND_RES) {
    if (re.test(command)) throw new TokenError("forbidden shell command", command);
  }
  if (!ALLOWED_COMMAND_HEADS.some((head) => command === head.trimEnd() || command.startsWith(head))) {
    throw new TokenError("shell command outside the allow-list", command);
  }
  const fileOp = /^(?:rm -f|mkdir -p) (\S+)$/.exec(command);
  if (/^(?:rm|mkdir) /.test(command) && !(fileOp && WRITABLE_PATH_PREFIXES.some((prefix) => fileOp[1].startsWith(prefix)))) {
    throw new TokenError("file operation outside the installer's own paths", command);
  }
  return command;
}

/** The complete set of shell commands this site can issue. */
export const cmd = {
  getprop: (key) => `getprop ${assertProp(key)}`,
  currentUser: () => "am get-current-user",
  listPackage: (pkg) => `pm list packages ${assertPackage(pkg)}`,
  listThirdParty: () => "pm list packages -3 --show-versioncode",
  dumpsysPackage: (pkg) => `dumpsys package ${assertPackage(pkg)}`,
  dumpsysDisplay: () => "dumpsys display",
  pmInstall: (path) => `pm install -r ${assertDevicePath(path)}`,
  pmUninstall: (pkg, keepData = false) => `pm uninstall ${keepData ? "-k " : ""}${assertPackage(pkg)}`,
  pmGrant: (pkg, permission, userId = 0) =>
    assertUserId(userId) === 0
      ? `pm grant ${assertPackage(pkg)} ${assertPermission(permission)}`
      : `pm grant --user ${userId} ${assertPackage(pkg)} ${assertPermission(permission)}`,
  appopsSet: (pkg, op) => `appops set ${assertPackage(pkg)} ${assertAppOp(op)} allow`,
  appopsGet: (pkg, op) => `appops get ${assertPackage(pkg)} ${assertAppOp(op)}`,
  allowListener: (component) => `cmd notification allow_listener ${assertComponent(component)}`,
  disallowListener: (component) => `cmd notification disallow_listener ${assertComponent(component)}`,
  dozeAdd: (pkg) => `dumpsys deviceidle whitelist +${assertPackage(pkg)}`,
  dozeRemove: (pkg) => `dumpsys deviceidle whitelist -${assertPackage(pkg)}`,
  rmForce: (path) => `rm -f ${assertDevicePath(path)}`,
  mkdirP: (path) => `mkdir -p ${assertDevicePath(path)}`,
  amStart: (component) => `am start -n ${assertComponent(component)}`,
  forceStop: (pkg) => `am force-stop ${assertPackage(pkg)}`,
  launch: (pkg) => `monkey -p ${assertPackage(pkg)} -c android.intent.category.LAUNCHER 1`,
};
