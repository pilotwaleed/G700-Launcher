// Pieces shared by the views.
import { t, hasKey } from "../i18n.js";
import { h, toast, icon } from "../ui.js";
import { LAUNCHER_GRANTS } from "../core/grant-plan.js";

export function viewHead(titleKey, leadKey, ...actions) {
  return h("header", { class: "view-head" },
    h("div", {}, h("h1", { i18n: titleKey }), h("p", { i18n: leadKey })),
    actions.length ? h("div", { class: "view-head-actions" }, ...actions) : null,
  );
}

export function panel(titleKey, iconName, ...children) {
  return h("section", { class: "panel glass" }, h("h2", {}, iconName ? icon(iconName) : null, h("span", { i18n: titleKey })), ...children);
}

/** Last segment of a grant name: android.car.permission.CAR_INFO → CAR_INFO, …/…MediaListenerService → MediaListenerService. */
export const shortGrantName = (name) => name.split(/[./]/).pop();

/** Title / subtitle / group for a launcher pipeline step, in the current language. */
export function describeLauncherStep(id, step) {
  if (id.startsWith("grant:")) {
    const name = id.slice("grant:".length);
    const row = LAUNCHER_GRANTS.find((grant) => grant[1] === name);
    const short = shortGrantName(name);
    return { title: short, sub: `${t(`grant.kind.${row ? row[0] : "pm"}`)} — ${t(`why.${short}`)}`, group: t("step.group.grants") };
  }
  const detailKey = step?.detail ? `step.detail.${step.detail}` : null;
  return { title: t(`step.${id}`), sub: detailKey && hasKey(detailKey) ? t(detailKey) : undefined };
}

/** @returns {boolean} false (with a toast) when no car is connected */
export function requireConnection(app) {
  if (app.connected) return true;
  toast(t("common.connectFirst"), "bad");
  return false;
}

export function abortMessage(error) {
  const key = `install.abort.${error?.reason}`;
  return hasKey(key) ? t(key) : t("install.abort.other", { message: String(error?.message ?? error).slice(0, 200) });
}
