// The one place that touches WebUSB and the vendored ADB engine (ya-webadb, MIT — see THIRD_PARTY.md).
// Everything else talks to a session through shell() and push().
//
// Key handling (ADR-005): the browser's ADB key is created by WebCrypto and kept in this browser's IndexedDB.
// It authenticates this browser to the car through the car's own "Allow USB debugging?" prompt. It is never
// copied into the car or into the launcher; the launcher's helper link makes its own key on the car.
import { Adb, AdbDaemonTransport, AdbDaemonWebUsbDeviceManager, AdbDaemonWebUsbDevice, AdbWebCredentialStore } from "../vendor/adb-engine.bundle.js";
import { assertSafeCommand, assertDevicePath, WRITABLE_PATH_PREFIXES, cmd } from "./core/tokens.js";
import { assertCommandTargetsAllowed } from "./core/package-guard.js";
import { LAUNCHER } from "./core/grant-plan.js";

const RC_MARK = "g700wi-rc:";
const CREDENTIAL_STORE = "g700-web-installer";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    /** True while tcpip() waits for the car's ADB to restart: the drop that follows is expected and is not announced. */
    this.restarting = false;
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
        credentialStore: new AdbWebCredentialStore(CREDENTIAL_STORE),
      });
    } catch (error) {
      throw new ConnectError("auth", error);
    }
    this.#adopt(new Adb(transport), device.serial);
    return { serial: device.serial, usbName: device.name };
  }

  #adopt(adb, serial) {
    this.adb = adb;
    this.serial = serial;
    adb.disconnected.then(
      () => this.dropped(adb),
      () => this.dropped(adb),
    );
  }

  /** The connection behind [adb] ended. While tcpip() waits for ADB to restart it says nothing: tcpip() reports the outcome. */
  dropped(adb) {
    if (this.adb !== adb) return;
    this.adb = null;
    if (!this.restarting) this.onDisconnect();
  }

  /**
   * Asks the car's ADB to listen on the admin link's port (the engine's own `tcpip:<port>` service — what `adb tcpip`
   * sends), then gets the car back: ADB restarts when asked, which drops this USB connection. The car was already
   * chosen in Chrome's picker, so it is found again without one; if its "Allow USB debugging?" prompt returns, the
   * owner taps Allow and the wait ends. Finally the port the car reports is read back.
   *
   * Only LAUNCHER.adminLinkPort is ever accepted. Nothing here is undone later: the listener belongs to the car's ADB.
   * @returns {Promise<{output: string, exitCode: number, back: boolean, listening: boolean}>}
   *   exitCode 0 = the car said it is restarting in TCP mode; back = this session is connected again;
   *   listening = the car reports the port.
   */
  async tcpip(port, { settleMs = 4000, waitMs = 40000, stepMs = 500 } = {}) {
    if (port !== LAUNCHER.adminLinkPort) throw new Error("only the admin link's port");
    const adb = this.adb;
    if (!adb) throw new Error("not connected");
    const serial = this.serial;
    this.restarting = true;
    try {
      let output;
      let accepted = true;
      try {
        output = String(await adb.tcpip.setPort(port)).trim();
      } catch (error) {
        accepted = false;
        output = String(error?.message ?? error).trim();
      }
      this.onCommand(`tcpip:${port}`, { output, exitCode: accepted ? 0 : 1 });
      if (!accepted) return { output, exitCode: 1, back: this.adb === adb, listening: false };
      // ADB restarts a moment after it answers. A car that keeps the connection simply carries on with it.
      const dropped = await Promise.race([adb.disconnected.then(() => true, () => true), sleep(settleMs).then(() => false)]);
      let back = !dropped && this.adb === adb;
      if (dropped) {
        this.adb = null;
        try { await adb.close(); } catch { /* already gone */ }
        back = await this.#reopen(serial, waitMs, stepMs);
      }
      let listening = false;
      if (back) {
        try {
          listening = (await this.shell(cmd.getprop("service.adb.tcp.port"))).output.trim() === String(port);
        } catch { /* the port simply stays unconfirmed */ }
      }
      return { output, exitCode: 0, back, listening };
    } finally {
      this.restarting = false;
      if (this.adb === null) this.onDisconnect();
    }
  }

  /** Finds the same car again among the devices Chrome already has permission for, and completes the handshake. */
  async #reopen(serial, waitMs, stepMs) {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    const until = Date.now() + waitMs;
    while (manager && Date.now() < until) {
      await sleep(stepMs);
      let device;
      try {
        device = (await manager.getDevices()).find((candidate) => candidate.serial === serial);
      } catch {
        device = undefined;
      }
      if (!device) continue;
      try {
        const connection = await device.connect();
        const handshake = AdbDaemonTransport.authenticate({ serial: device.serial, connection, credentialStore: new AdbWebCredentialStore(CREDENTIAL_STORE) });
        // The car may ask "Allow USB debugging?" again; the wait for that tap is bounded like the rest.
        const transport = await Promise.race([handshake, sleep(Math.max(0, until - Date.now())).then(() => null)]);
        if (!transport) {
          // Too late: if the handshake still completes, it is closed rather than adopted behind the owner's back.
          handshake.then((late) => late.close?.(), () => {});
          return false;
        }
        this.#adopt(new Adb(transport), device.serial);
        return true;
      } catch { /* ADB is still restarting, or the interface is busy: look again */ }
    }
    return false;
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
