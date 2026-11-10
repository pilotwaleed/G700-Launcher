// The one place that touches WebUSB and the vendored ADB engine (ya-webadb, MIT — see THIRD_PARTY.md).
// Everything else talks to a session through shell() and push().
//
// Key handling (ADR-005): the browser's ADB key is created by WebCrypto and kept in this browser's IndexedDB.
// It authenticates this browser to the car through the car's own "Allow USB debugging?" prompt. It is never
// copied into the car or into the launcher; the launcher's helper link makes its own key on the car.
import { Adb, AdbDaemonTransport, AdbDaemonWebUsbDeviceManager, AdbDaemonWebUsbDevice, AdbWebCredentialStore } from "../vendor/adb-engine.bundle.js";
import { assertSafeCommand, assertDevicePath, WRITABLE_PATH_PREFIXES } from "./core/tokens.js";
import { assertCommandTargetsAllowed } from "./core/package-guard.js";

const RC_MARK = "g700wi-rc:";

export class ConnectError extends Error {
  constructor(kind, cause) {
    super(cause?.message ?? kind);
    this.name = "ConnectError";
    this.kind = kind; // "cancelled" | "busy" | "auth" | "generic"
  }
}

export class AdbSession {
  constructor({ onCommand, onDisconnect } = {}) {
    this.adb = null;
    this.serial = "";
    this.onCommand = onCommand ?? (() => {});
    this.onDisconnect = onDisconnect ?? (() => {});
  }

  static get supported() {
    return Boolean(AdbDaemonWebUsbDeviceManager.BROWSER);
  }

  get connected() {
    return this.adb !== null;
  }

  /** Opens Chrome's device picker and completes the ADB handshake (the car shows its authorisation prompt). */
  async connect() {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) throw new ConnectError("generic", new Error("WebUSB is not available"));
    const device = await manager.requestDevice();
    if (!device) throw new ConnectError("cancelled");
    let connection;
    try {
      connection = await device.connect();
    } catch (error) {
      throw new ConnectError(error instanceof AdbDaemonWebUsbDevice.DeviceBusyError ? "busy" : "generic", error);
    }
    let transport;
    try {
      transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: new AdbWebCredentialStore("g700-web-installer"),
      });
    } catch (error) {
      throw new ConnectError("auth", error);
    }
    const adb = new Adb(transport);
    this.adb = adb;
    this.serial = device.serial;
    adb.disconnected.then(
      () => this.#dropped(adb),
      () => this.#dropped(adb),
    );
    return { serial: device.serial, usbName: device.name };
  }

  #dropped(adb) {
    if (this.adb !== adb) return;
    this.adb = null;
    this.onDisconnect();
  }

  async disconnect() {
    const adb = this.adb;
    this.adb = null;
    if (adb) {
      try { await adb.close(); } catch { /* already gone */ }
    }
  }

  /**
   * Runs one allow-listed command. Uses the shell protocol (separate exit code) when the car supports it,
   * otherwise the legacy exec service with a fixed exit-code marker appended.
   * @returns {Promise<{output: string, exitCode: number|null}>}
   */
  async shell(command) {
    assertCommandTargetsAllowed(assertSafeCommand(command));
    const adb = this.adb;
    if (!adb) throw new Error("not connected");
    let reply;
    const v2 = adb.subprocess.shellProtocol;
    if (v2?.isSupported) {
      const result = await v2.spawnWaitText([command]);
      reply = { output: `${result.stdout}${result.stderr}`.trim(), exitCode: result.exitCode };
    } else {
      const text = await adb.subprocess.noneProtocol.spawnWaitText([`${command}; echo ${RC_MARK}$?`]);
      const at = text.lastIndexOf(RC_MARK);
      const code = at === -1 ? NaN : Number.parseInt(text.slice(at + RC_MARK.length), 10);
      reply = { output: (at === -1 ? text : text.slice(0, at)).trim(), exitCode: Number.isInteger(code) ? code : null };
    }
    this.onCommand(command, reply);
    return reply;
  }

  /** Copies a Blob to one of the installer's own paths on the car. */
  async push(devicePath, blob, onProgress) {
    assertDevicePath(devicePath);
    if (!WRITABLE_PATH_PREFIXES.some((prefix) => devicePath.startsWith(prefix))) throw new Error("push outside the installer's own paths");
    const adb = this.adb;
    if (!adb) throw new Error("not connected");
    const total = blob.size;
    let sent = 0;
    const counter = new TransformStream({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        onProgress?.(sent, total);
        controller.enqueue(chunk);
      },
    });
    const sync = await adb.sync();
    try {
      await sync.write({ filename: devicePath, file: blob.stream().pipeThrough(counter), permission: 0o644 });
    } finally {
      await sync.dispose();
    }
    this.onCommand(`push ${total} bytes -> ${devicePath}`, { output: "", exitCode: 0 });
  }
}
