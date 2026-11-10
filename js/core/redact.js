// Serial masking, report redaction, display summary and the diagnostics report builder. Pure.

export const REDACTED = "[redacted]";

/** For on-screen display: bullets plus the last two characters, e.g. "••••••••7F". Never the full value. */
export function maskSerial(serial) {
  const value = String(serial ?? "");
  if (value.length === 0) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return "•".repeat(Math.min(value.length - 2, 10)) + value.slice(-2);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Redacts identifiers from free text: the given secrets (serials), MAC addresses, 14–17 digit runs
 * (IMEI/ICCID-like) and e-mail addresses — the same three patterns as tools/g700ctl.py diagnose.
 */
export function redactText(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) out = out.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  out = out.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, REDACTED);
  out = out.replace(/\b\d{14,17}\b/g, REDACTED);
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED);
  return out;
}

/** `dumpsys display` → a short list of physical display devices and the logical display ids. */
export function summarizeDisplays(text) {
  const source = String(text ?? "");
  const devices = [];
  const seen = new Set();
  const deviceRe = /DisplayDeviceInfo\{"([^"]{0,80})": uniqueId="([^"]{0,120})", (\d{2,5}) x (\d{2,5})([^\n]*)/g;
  let match;
  while ((match = deviceRe.exec(source)) !== null) {
    const [, name, uniqueId, width, height, rest] = match;
    if (seen.has(uniqueId)) continue;
    seen.add(uniqueId);
    const density = /\bdensity (\d{2,4})\b/.exec(rest);
    const type = /\btype ([A-Z_]{2,20})\b/.exec(rest);
    const refresh = /\b(?:renderFrameRate|fps[= ])\s*([\d.]{1,8})/.exec(rest);
    devices.push({
      name,
      uniqueId,
      width: Number(width),
      height: Number(height),
      density: density ? Number(density[1]) : null,
      type: type ? type[1] : null,
      refreshRate: refresh ? Number(refresh[1]) : null,
    });
  }
  const logicalIds = [...new Set([...source.matchAll(/\bmDisplayId=(\d{1,5})\b/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return { devices, logicalIds };
}

/**
 * @param data {generatedAt, serial, deviceSerials (other spellings of the serial to hide; never printed), includeSerial, props, currentUser, displays, launcher: {installed, versionName, versionCode},
 *              grants: [{name, kind, state}], latest: {version, versionCode}|null, thirdPartyCount}
 * @returns {string} pretty JSON; the serial is redacted unless includeSerial is true
 */
export function buildDiagnosticsReport(data) {
  const includeSerial = data.includeSerial === true;
  const report = {
    tool: "g700 web installer diagnostics",
    generatedAt: data.generatedAt,
    evidence: "read from the connected device over WebUSB ADB; nothing was changed",
    serial: includeSerial ? data.serial ?? null : REDACTED,
    props: data.props ?? {},
    currentUser: data.currentUser ?? null,
    displays: data.displays ?? { devices: [], logicalIds: [] },
    launcher: data.launcher ?? { installed: false },
    latestPublished: data.latest ?? null,
    grants: data.grants ?? [],
    thirdPartyCount: data.thirdPartyCount ?? null,
  };
  const text = JSON.stringify(report, null, 2);
  // MAC / long-number / e-mail patterns are always removed; the serial only stays when the owner asked for it.
  const serials = [data.serial, data.props?.["ro.serialno"], ...(Array.isArray(data.deviceSerials) ? data.deviceSerials : [])];
  return redactText(text, includeSerial ? [] : serials.filter(Boolean));
}
