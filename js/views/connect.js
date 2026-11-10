// Connect: WebUSB picker → ADB handshake → device panel.
import { t } from "../i18n.js";
import { h, icon, ltr, note, clear } from "../ui.js";
import { maskSerial } from "../core/redact.js";
import { viewHead, panel } from "./shared.js";

let app;
let deviceBox;
let connectButton;
let serialShown = false;

export function init(root, appRef) {
  app = appRef;
  connectButton = h("button", { type: "button", class: "btn btn-primary btn-hero", on: { click: () => (app.connected ? app.disconnect() : app.connect()) } });
  const prep = (key) => h("li", { class: "inset" }, h("div", {}, h("strong", { i18n: `connect.prep.${key}.t` }), h("span", { i18n: `connect.prep.${key}.d` })));
  deviceBox = h("div", {});
  root.append(
    viewHead("connect.title", "connect.lead"),
    h("div", { class: "grid-2" },
      panel("connect.prep.title", "info",
        h("ol", { class: "prep" }, prep("browser"), prep("cable"), prep("adb"), prep("allow")),
        h("p", { class: "faint", i18n: "connect.park" }),
      ),
      h("div", { class: "stack" },
        h("section", { class: "panel glass" },
          h("h2", {}, icon("car"), h("span", { i18n: "connect.device.title" })),
          deviceBox,
          h("div", { class: "hero-row" }, connectButton,
            h("button", { type: "button", class: "btn btn-quiet", id: "connect-refresh", on: { click: () => app.exclusive(() => app.refreshDevice()) } }, icon("refresh"), h("span", { i18n: "common.refresh" })),
          ),
        ),
      ),
    ),
  );
}

export function render() {
  clear(connectButton).append(icon("usb"), h("span", { text: app.connecting ? t("connect.connecting") : app.connected ? t("connect.disconnect") : t("connect.button") }));
  connectButton.disabled = app.connecting || !app.supported || (app.busy && app.connected);
  connectButton.className = app.connected ? "btn btn-hero" : "btn btn-primary btn-hero";
  document.getElementById("connect-refresh").hidden = !app.connected;
  document.getElementById("connect-refresh").disabled = app.busy;

  if (!app.connected || !app.device) {
    serialShown = false;
    deviceBox.replaceChildren(h("div", { class: "device-empty" }, icon("usb"), h("strong", { text: t("connect.device.empty") }), h("span", { text: t("connect.device.emptyHint") })));
    return;
  }
  const { props, serial, currentUser } = app.device;
  const launcher = app.launcher;
  const fact = (key, ...value) => [h("dt", { text: t(key) }), h("dd", {}, ...value)];
  const serialToggle = h("button", { type: "button", class: "btn btn-quiet btn-small", on: { click: () => { serialShown = !serialShown; render(); } } },
    icon("eye"), h("span", { text: serialShown ? t("connect.hide") : t("connect.reveal") }));
  deviceBox.replaceChildren(
    h("dl", { class: "facts" },
      fact("connect.f.model", ltr([props["ro.product.manufacturer"], props["ro.product.model"]].filter(Boolean).join(" ") || "—")),
      fact("connect.f.android", h("span", { text: t("connect.androidValue", { release: props["ro.build.version.release"] || "?", sdk: props["ro.build.version.sdk"] || "?" }) })),
      fact("connect.f.build", ltr(props["ro.build.display.id"] || "—", "mono")),
      fact("connect.f.serial", ltr(serialShown ? serial : maskSerial(serial), "mono"), serialToggle),
      fact("connect.f.user", ltr(String(currentUser))),
      fact("connect.f.launcher", launcher.installed
        ? h("span", { class: "badge badge-ok", text: t("connect.installedValue", { name: launcher.versionName ?? "?", code: launcher.versionCode ?? "?" }) })
        : h("span", { class: "badge badge-warn", text: t("connect.notInstalled") })),
    ),
  );
  if (!launcher.installed) deviceBox.append(note("info", h("span", { text: t("tools.update.status.not-installed") })));
}
