// "Reinstall from your phone" (ADR-102): the language switch and the line that says what this device can do.
// Nothing here touches WebUSB or the car; the installer itself is the other page.
import { t, setLang, loadSavedLang, getLang, onLangChange } from "./i18n.js";
import { routeFor } from "./core/reinstall-route.js";

const you = document.getElementById("re-you");

function render() {
  document.title = `${t("re.title")} — ${t("brand.name")}`;
  const kind = routeFor(navigator.userAgent, Boolean(navigator.usb) && window.isSecureContext, navigator.maxTouchPoints);
  you.textContent = t(`re.you.${kind}`);
  you.dataset.kind = kind;
  for (const button of document.querySelectorAll(".lang-btn")) button.setAttribute("aria-pressed", String(button.dataset.lang === getLang()));
}

for (const button of document.querySelectorAll(".lang-btn")) button.addEventListener("click", () => setLang(button.dataset.lang));
onLangChange(render);
setLang(loadSavedLang());
