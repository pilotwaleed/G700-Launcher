// Language state and lookup. No DOM access at import time, so tests can import it in Node.
import { STRINGS } from "./strings.js";

const STORAGE_KEY = "g700wi.lang";
export const LANGS = Object.freeze(["en", "ar"]);
let current = "en";
const listeners = new Set();

export function format(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : whole));
}

/** Translate a key in the current language; falls back to English, then to the key itself. */
export function t(key, params) {
  const template = STRINGS[current]?.[key] ?? STRINGS.en[key];
  return template === undefined ? key : format(template, params);
}

export const hasKey = (key) => Object.prototype.hasOwnProperty.call(STRINGS.en, key);
export const getLang = () => current;
export const isRtl = () => current === "ar";
export const onLangChange = (fn) => void listeners.add(fn);

export function loadSavedLang() {
  try {
    const saved = globalThis.document ? globalThis.localStorage?.getItem(STORAGE_KEY) : null;
    if (LANGS.includes(saved)) return saved;
  } catch { /* storage blocked: fall through */ }
  const preferred = (globalThis.navigator?.language || "en").toLowerCase();
  return preferred.startsWith("ar") ? "ar" : "en";
}

export function setLang(lang) {
  current = LANGS.includes(lang) ? lang : "en";
  try {
    if (globalThis.document) globalThis.localStorage?.setItem(STORAGE_KEY, current);
  } catch { /* storage blocked: the choice lasts for this page only */ }
  const root = globalThis.document?.documentElement;
  if (root) {
    root.lang = current;
    root.dir = isRtl() ? "rtl" : "ltr";
    applyI18n(globalThis.document);
    globalThis.document.title = `${t("brand.name")} — ${t("brand.sub")}`;
  }
  for (const fn of listeners) fn(current);
}

/** Re-apply text to every element carrying data-i18n (and data-i18n-args / -placeholder / -label). */
export function applyI18n(root) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    let params;
    if (node.dataset.i18nArgs) {
      try { params = JSON.parse(node.dataset.i18nArgs); } catch { params = undefined; }
    }
    node.textContent = t(node.dataset.i18n, params);
  }
  for (const node of root.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of root.querySelectorAll("[data-i18n-label]")) node.setAttribute("aria-label", t(node.dataset.i18nLabel));
}
