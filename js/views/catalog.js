// Get apps: cards from catalog.json. A browser cannot fetch another site's APK, so each card links to the
// publisher's own page and offers a drop target that hands the downloaded file to the Apps installer.
import { t, getLang } from "../i18n.js";
import { h, icon, ltr, note, dropZone } from "../ui.js";
import { viewHead } from "./shared.js";

let app;
let cardsBox;
let onInstall = () => {};

export function init(root, appRef, { installFiles }) {
  app = appRef;
  onInstall = installFiles;
  cardsBox = h("div", { class: "cards" });
  root.append(viewHead("catalog.title", "catalog.lead"), note("warn", h("span", { i18n: "catalog.parked" })), cardsBox);
}

const localized = (value) => (value && typeof value === "object" ? value[getLang()] ?? value.en ?? "" : typeof value === "string" ? value : "");

/** Only https links to the listed publisher page are ever rendered. */
function safeUrl(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function badges(entry) {
  const gms = ["none", "partial", "required"].includes(entry.googleServices) ? entry.googleServices : null;
  return h("div", { class: "card-badges" },
    entry.openSource === true ? h("span", { class: "badge badge-ok", text: t("catalog.badge.oss") }) : null,
    gms ? h("span", { class: `badge ${gms === "none" ? "badge-ok" : gms === "partial" ? "badge-warn" : "badge-bad"}`, text: t(`catalog.badge.gms.${gms}`) }) : null,
    entry.drm === true ? h("span", { class: "badge badge-warn", text: t("catalog.badge.drm") }) : null,
    entry.viaPlayStore === true ? h("span", { class: "badge badge-warn", text: t("catalog.badge.store") }) : null,
    entry.needsAccount === true ? h("span", { class: "badge", text: t("catalog.badge.account") }) : null,
  );
}

function card(entry, installed) {
  const url = safeUrl(entry.source?.url);
  const name = localized(entry.name);
  const noteText = localized(entry.note);
  return h("article", { class: "card glass" },
    h("div", { class: "card-head" },
      h("span", { class: "app-glyph", text: (String(entry.name?.en ?? name).match(/[\p{L}\p{N}]/u) ?? ["?"])[0] }),
      h("div", {}, h("h3", { text: name }), url ? ltr(new URL(url).hostname.replace(/^www\./, ""), "card-source") : null),
      h("span", { class: "spacer" }),
      installed ? h("span", { class: "badge badge-ok", text: t("catalog.installed") }) : null,
    ),
    h("p", { text: localized(entry.summary) }),
    badges(entry),
    noteText ? h("div", { class: "card-note inset", text: noteText }) : null,
    h("div", { class: "card-foot" },
      url ? h("a", { class: "btn", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", { text: t("catalog.open") })) : null,
      dropZone({ compact: true, labelKey: "catalog.drop", chooseKey: "catalog.choose", onFiles: (files) => onInstall(files) }),
    ),
  );
}

export function render() {
  const catalog = app.catalog;
  if (catalog === null) { cardsBox.replaceChildren(); return; }
  if (catalog === false || !Array.isArray(catalog.apps)) { cardsBox.replaceChildren(note("bad", h("span", { text: t("catalog.loadFailed") }))); return; }
  const installed = app.userInstalled();
  cardsBox.replaceChildren(...catalog.apps.filter((entry) => entry && typeof entry === "object").map((entry) =>
    card(entry, Array.isArray(entry.packages) && entry.packages.some((pkg) => installed.has(pkg)))));
}
