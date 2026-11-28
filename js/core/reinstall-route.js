// "Reinstall from your phone" (ADR-102): which route the device showing the page can take. Pure, so tests run it in Node.
//   android      — an Android browser with WebUSB (Chrome): route 1, phone + OTG adapter + cable, works from here.
//   androidNoUsb — Android without WebUSB (Firefox, Samsung Internet without it, an in-app browser): open it in Chrome.
//   iphone       — iPhone / iPad: every browser there is WebKit, which has no WebUSB; it can only keep the backup.
//   computer     — a desktop browser with WebUSB: the full installer, as before.
//   unknown      — anything else.

/** iPadOS 13+ reports itself as a Mac; a Mac with a touch screen is an iPad. */
function isAppleMobile(userAgent, maxTouchPoints) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && Number(maxTouchPoints) > 1;
}

export function routeFor(userAgent = "", hasWebUsb = false, maxTouchPoints = 0) {
  const ua = String(userAgent);
  if (isAppleMobile(ua, maxTouchPoints)) return "iphone";
  if (/Android/i.test(ua)) return hasWebUsb ? "android" : "androidNoUsb";
  return hasWebUsb ? "computer" : "unknown";
}

export const ROUTE_KINDS = Object.freeze(["android", "androidNoUsb", "iphone", "computer", "unknown"]);
