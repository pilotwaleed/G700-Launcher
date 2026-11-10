// Small DOM toolkit: element builder, inline SVG icons, step checklist, dialog, toasts, activity log.
// Text from the car, from files and from JSON is only ever placed with textContent.
import { t, applyI18n } from "./i18n.js";

/** Inline SVG icons (24×24, stroke = currentColor). Constant strings only. */
const ICON_PATHS = {
  usb: '<path d="M12 21V8m0 0l-3 3m3-3l3 3M12 8V3m-2 2h4M7 13v2a2 2 0 002 2h3m5-6v2a2 2 0 01-2 2h-3"/><circle cx="12" cy="21" r="1.4"/>',
  download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  store: '<path d="M4 9l1.4-4.5h13.2L20 9M4 9v10h16V9M4 9h16M9 19v-5h6v5"/>',
  wrench: '<path d="M14.5 6.2a4.2 4.2 0 005.2 5.2L11 20.1a2.2 2.2 0 01-3.1-3.1l8.7-8.7a4.2 4.2 0 00-2.1-2.1z"/><path d="M14.5 6.2l2.8-1.7 2.2 2.2-1.7 2.8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  minus: '<path d="M6 12h12"/>',
  dot: '<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.2"/>',
  car: '<path d="M4 15l1.6-5.2A2.5 2.5 0 018 8h8a2.5 2.5 0 012.4 1.8L20 15v3.5h-2.5V17h-11v1.5H4z"/><path d="M7.5 13.5h.2M16.3 13.5h.2M6 11.5h12"/>',
  file: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M11 6H6v12h12v-5"/>',
  refresh: '<path d="M19 12a7 7 0 11-2.3-5.2M19 5v4h-4"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.8"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7M10.5 10.5v6M13.5 10.5v6"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  arrowUp: '<path d="M12 19V5m0 0l-5 5m5-5l5 5"/>',
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = ICON_PATHS[name] ?? ICON_PATHS.dot; // constant markup from the table above
  return svg;
}

/**
 * Element builder. Props: class, text, i18n (key), i18nArgs, on: {event: fn}, data: {k: v}, plus plain attributes.
 * Children: nodes, strings (as text), arrays, or null/false (ignored).
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "i18n") { node.dataset.i18n = value; node.textContent = t(value, props.i18nArgs); }
    else if (key === "i18nArgs") node.dataset.i18nArgs = JSON.stringify(value);
    else if (key === "i18nPlaceholder") { node.dataset.i18nPlaceholder = value; node.placeholder = t(value); }
    else if (key === "i18nLabel") { node.dataset.i18nLabel = value; node.setAttribute("aria-label", t(value)); }
    else if (key === "on") for (const [event, fn] of Object.entries(value)) node.addEventListener(event, fn);
    else if (key === "data") for (const [name, v] of Object.entries(value)) node.dataset[name] = v;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const ltr = (text, extraClass = "") => h("bdi", { class: `ltr ${extraClass}`.trim(), dir: "ltr", text });

export function note(kind, ...children) {
  const iconName = kind === "ok" ? "check" : kind === "info" ? "info" : "warn";
  return h("div", { class: `note${kind === "info" ? "" : ` note-${kind}`}` }, icon(iconName), h("div", {}, ...children));
}

/** Command + raw reply, collapsed. */
export function rawDetails(command, output) {
  if (!command && !output) return null;
  const text = [command ? `$ ${command}` : null, output ? String(output).trim() : null].filter(Boolean).join("\n");
  return h("details", { class: "raw" }, h("summary", { i18n: "common.raw" }), h("pre", { text }));
}

// ------------------------------------------------------------------ step checklist

const STATUS_ICON = { pending: "dot", running: null, pass: "check", skip: "minus", fail: "cross" };

export class StepList {
  /**
   * @param container element to render into
   * @param describe (id, step) => {title: string, sub?: string, group?: string} — called on every render, so it follows the language
   */
  constructor(container, describe) {
    this.container = container;
    this.describe = describe;
    this.order = [];
    this.steps = new Map();
    this.openIds = new Set();
  }
  reset(ids) {
    this.order = [...ids];
    this.steps = new Map(ids.map((id) => [id, { id, status: "pending" }]));
    this.openIds.clear();
    this.render();
  }
  update(step) {
    if (!this.steps.has(step.id)) this.order.push(step.id);
    this.steps.set(step.id, { ...this.steps.get(step.id), ...step });
    this.render();
  }
  get isEmpty() { return this.order.length === 0; }
  count(status) { return [...this.steps.values()].filter((s) => s.status === status).length; }
  render() {
    for (const details of this.container.querySelectorAll("details[data-step]")) {
      if (details.open) this.openIds.add(details.dataset.step); else this.openIds.delete(details.dataset.step);
    }
    const list = h("ol", { class: "steps" });
    let lastGroup = null;
    for (const id of this.order) {
      const step = this.steps.get(id);
      const info = this.describe(id, step);
      if (info.group && info.group !== lastGroup) list.append(h("li", { class: "group-title", text: info.group }));
      lastGroup = info.group ?? null;
      const mark = h("span", { class: "step-mark" }, STATUS_ICON[step.status] ? icon(STATUS_ICON[step.status]) : null);
      const raw = rawDetails(step.command, step.output);
      if (raw) {
        raw.dataset.step = id;
        raw.open = this.openIds.has(id) || step.status === "fail";
      }
      const progress = step.status === "running" && typeof step.progress === "number" ? h("progress", { max: "1", value: String(step.progress) }) : null;
      list.append(
        h("li", { class: "step inset", data: { status: step.status } },
          mark,
          h("div", {}, h("div", { class: "step-title", text: info.title }), info.sub ? h("div", { class: "step-sub", text: info.sub }) : null),
          h("span", { class: "step-state", text: t(`status.${step.status}`) }),
          progress || raw ? h("div", { class: "step-extra" }, progress, raw) : null,
        ),
      );
    }
    this.container.replaceChildren(list);
  }
}

// ------------------------------------------------------------------ dialog and toasts

/** @returns {Promise<boolean>} true when the owner confirmed */
export function confirmDialog({ titleKey, titleArgs, content = [], okKey, danger = false }) {
  const dialog = document.getElementById("dialog");
  const ok = document.getElementById("dialog-ok");
  document.getElementById("dialog-title").textContent = t(titleKey, titleArgs);
  document.getElementById("dialog-content").replaceChildren(...content.filter(Boolean));
  document.getElementById("dialog-cancel").textContent = t("common.cancel");
  ok.textContent = t(okKey);
  ok.className = danger ? "btn btn-danger" : "btn btn-primary";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    dialog.returnValue = "cancel";
    dialog.showModal();
    document.getElementById("dialog-cancel").focus();
  });
}

export function toast(message, kind = "info") {
  const node = h("div", { class: `toast${kind === "bad" ? " toast-bad" : kind === "ok" ? " toast-ok" : ""}`, text: message });
  document.getElementById("toasts").append(node);
  setTimeout(() => node.remove(), kind === "bad" ? 9000 : 4500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("common.copied"), "ok");
    return true;
  } catch {
    toast(t("common.copyFailed"), "bad");
    return false;
  }
}

// ------------------------------------------------------------------ activity log

const MAX_LOG = 400;
const entries = [];
let redactor = (text) => text;

export const activityLog = {
  setRedactor(fn) { redactor = fn; },
  add(kind, text, extra = "") {
    entries.push({ kind, text: redactor(String(text)), extra: redactor(String(extra)), at: new Date() });
    if (entries.length > MAX_LOG) entries.shift();
    this.render();
  },
  command(command, reply) {
    this.add("cmd", `$ ${command}`, `${reply.output ? `${reply.output}\n` : ""}[exit ${reply.exitCode ?? "?"}]`);
  },
  clear() { entries.length = 0; this.render(); },
  text() {
    return entries.map((e) => `${e.at.toISOString()} ${e.text}${e.extra ? `\n${e.extra}` : ""}`).join("\n");
  },
  render() {
    const list = document.getElementById("log-list");
    if (!list) return;
    document.getElementById("log-count").textContent = String(entries.length);
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.replaceChildren(...entries.map((e) => h("li", {},
      h("span", { class: e.kind === "cmd" ? "log-cmd" : e.kind === "error" ? "log-err" : "log-info", text: e.text }),
      e.extra ? h("span", { class: "log-rc", text: `\n${e.extra}` }) : null,
    )));
    if (stick) list.scrollTop = list.scrollHeight;
  },
};

/** File helpers shared by the drop zones. */
export const isApkFile = (file) => /\.apk$/i.test(file?.name ?? "");

export function dropZone({ compact = false, multiple = false, labelKey, chooseKey, onFiles }) {
  const input = h("input", { type: "file", class: "file-input", accept: ".apk,application/vnd.android.package-archive", multiple, tabindex: "-1" });
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    if (files.length) onFiles(files);
  });
  const zone = h("div", { class: `drop${compact ? " drop-compact" : ""}` },
    icon("arrowUp"),
    h("span", { i18n: labelKey }),
    h("button", { type: "button", class: "linklike", i18n: chooseKey, on: { click: () => input.click() } }),
    input,
  );
  zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("is-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-over");
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  });
  return zone;
}

export { applyI18n };
