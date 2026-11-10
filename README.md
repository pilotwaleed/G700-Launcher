# Waleed Al Ansari Launcher — web installer

A static site that installs and manages the launcher (`com.g700studio`) on a Jetour G700 head unit from
**desktop Chrome or Edge over WebUSB + ADB**. Plain HTML/CSS/JS modules: no framework, no CDN, no backend,
no telemetry. English and Arabic (full RTL).

> **Status: not verified on a real car.** Everything here was checked with unit tests against a pretend
> device and by loading the pages in a browser. No command has been sent to a G700 from this site yet.
> See [What is untested](#what-is-untested-on-a-real-car).

## Serve it locally

```bash
npx serve web-installer        # from the repository root; then open the printed http://localhost:… address
```

`localhost` is a secure context, so WebUSB works. Any static file server will do
(`python3 -m http.server -d web-installer 8080`). Opening `index.html` from disk (`file://`) does not work:
ES modules and WebUSB both need http(s).

Before connecting: close Android Studio and run `adb kill-server` if you use the adb command line — only one
program can hold the car's debugging interface.

## Publish it

The folder is the site. Host it on any HTTPS static host.

- **GitHub Pages:** publish the contents of `web-installer/` (for example with a Pages workflow whose artifact
  path is `web-installer`, or by copying the folder to a `gh-pages` branch). WebUSB requires HTTPS, which Pages provides.
- **Anything else** (Netlify, Cloudflare Pages, S3 + CloudFront, nginx): upload the folder as-is. No build step.

`node_modules/` is not needed on the host. The repository's root `.gitignore` ignores `*.apk`, so a release APK
placed in `apks/` is **not committed by default** — either `git add -f web-installer/apks/<file>.apk` or have
the publishing step copy it in.

## Publish a new launcher APK

1. Copy the signed release to `web-installer/apks/`, e.g. `WaleedAlAnsariLauncher-0.3.0.apk`
   (letters, digits, `.`, `_`, `-` only; must end in `.apk`).
2. Get its size and digest:
   ```bash
   stat -f %z web-installer/apks/WaleedAlAnsariLauncher-0.3.0.apk      # macOS (Linux: stat -c %s)
   shasum -a 256 web-installer/apks/WaleedAlAnsariLauncher-0.3.0.apk
   ```
3. Update `web-installer/apks/latest.json`:
   ```json
   {"version":"0.3.0","versionCode":3,"file":"WaleedAlAnsariLauncher-0.3.0.apk","size":5003083,"sha256":"<64 hex>","date":"2026-11-10"}
   ```
4. Remove older APK files from `apks/`.

While `"file"` is `null` the Install tab says "No APK published yet — choose a local APK". With a file present
the site downloads it same-origin, computes SHA-256 with WebCrypto and **refuses to install on a mismatch**
before anything is sent to the car. If `latest.json` is incomplete (bad digest, size, name) the published
option is disabled and the reason is shown.

## What each tab does

| Tab | What it does |
| --- | --- |
| **Connect** | Chrome's device picker → ADB handshake (the car shows "Allow USB debugging?") → model, Android version, firmware build id, serial (masked; press Show), Android user, installed launcher version. Detects unplug. The "before you start" note tells the owner to enable ADB with the procedure they already use; **this site contains no engineering-menu code and no code generator.** |
| **Install / Update** | One button: verify SHA-256 → copy the APK to `/data/local/tmp` → `pm install -r` → grants → doze allow-list → clear the kill switch → journal → launch. Live checklist with pass / skip / fail and the raw reply per step. "Use a local APK" for offline or unpublished builds (shown as *not verifiable* unless it is byte-identical to the published release, and confirmed explicitly). |
| **Fix permissions** | For one user-installed app or all of them: reads `dumpsys package <pkg>`, then grants only what the app requested — runtime permissions with `pm grant`, and special access with `appops set … allow` when the matching permission is declared (overlay, install unknown apps, usage access, write settings, all-files access, exact alarms, full-screen intent, turn screen on; battery-optimisation exemption via the doze allow-list). Developer-level permissions (WRITE_SECURE_SETTINGS, READ_LOGS, DUMP) only with an explicit tick, one app at a time. Result table per permission. |
| **Apps** | Lists `pm list packages -3`. Launch, Force stop, Uninstall (with confirmation). Install one or several local `.apk` files with progress. |
| **Get apps** | Cards from `catalog.json` (plain data, official publisher pages only). A browser cannot fetch another site's APK, so a card opens the official page in a new tab; drop the downloaded file on the card and it goes to the Apps installer. |
| **Tools** | Update check (installed `versionCode` vs `latest.json`), Repair (re-apply grants), Uninstall launcher (reports what this browser's journal says was changed), diagnostics report with the serial redacted by default. |

The **Activity log** at the bottom shows every command sent and its raw reply; the serial is hidden there too.

## Safety model

- **Parity with `tools/g700ctl.py`.** `js/core/grant-plan.js` `LAUNCHER_GRANTS` is the same list, in the same
  order, as `GRANTS` in `g700ctl.py`; a unit test reads the Python file and fails if they differ. Install,
  repair and uninstall issue the same commands in the same order (pinned by `test/pipeline.test.js`).
  A grant the car refuses or does not define is a **skip**, never an abort — as in `g700ctl.py`.
  **If you change one, change the other in the same commit.**
- **No key is put in the car (ADR-005).** The browser's ADB key is generated by WebCrypto, stays in this
  browser's IndexedDB, and is only *authorised* by the car's own prompt (tick "Always allow" or not — your
  choice). Nothing is pushed to the launcher's storage except `install-journal.json`. The launcher's helper
  link creates its own key on the car, exactly as it does after a `g700ctl.py` install.
- **Allow-listed commands.** Every command is built in `js/core/tokens.js` from validated tokens
  (package / permission / app-op / component / path regexes) and re-checked at the last moment against a fixed
  allow-list of command heads and a character whitelist (no quotes, pipes, `;`, `$`, redirects). File names
  are never sent to the car: uploads use fixed names under `/data/local/tmp/g700wi-…`.
- **Package guard.** Uninstall, force stop, launch and permission fixes require the package to be in the car's
  own `-3` list **and** not under `android`, `com.android.`, `com.autolink.`, `com.chery.`, `com.jetour.`,
  `com.qualcomm.`, `com.qti.`, `com.google.android.gms` and similar prefixes (`js/core/package-guard.js`).
  The site has no code path for disabling or crashing a package or for changing system settings.
- **Journal.** Each install / repair / uninstall is recorded in `localStorage` under a short hash of the
  serial (never the serial itself), and the install journal is also written to
  `/sdcard/Android/data/com.g700studio/files/install-journal.json`, like `g700ctl.py`.
- **Page hardening.** A Content-Security-Policy limits scripts, styles, fonts and network requests to the
  site's own origin. Outside links (Get apps) open in a new tab with `noopener noreferrer`.

## Development

```bash
cd web-installer
npm install              # dev dependencies only: esbuild + the ya-webadb packages
npm test                 # node --test "test/*.test.js" — no test framework; pretend car, no USB
npm run check            # node --check on every script + import of the DOM-free modules
npm run build:engine     # rebuild vendor/adb-engine.bundle.js (only after changing dependency versions)
```

`vendor/adb-engine.bundle.js` is committed so that serving needs no build. Third-party code and fonts are
listed in [THIRD_PARTY.md](THIRD_PARTY.md).

Layout: `js/core/` holds the pure, unit-tested logic (token validation, package guard, `dumpsys` parser, grant
plans, version/manifest checks, redaction, journal, and the pipelines, which run against an abstract device).
`js/adb-session.js` is the only file that touches WebUSB. `js/views/` are the six tabs. `js/strings.js` holds
all English and Arabic text.

## What is untested on a real car

Nothing below has been run against the owner's G700. Treat each as an assumption to verify with the car parked:

- The WebUSB handshake with this head unit (USB interface class, the authorisation prompt, whether the unit
  exposes ADB on the upper driver-side port to a browser the same way it does to desktop adb).
- `pm install -r` from `/data/local/tmp`, and writing the journal under `/sdcard/Android/data/com.g700studio/files`
  with the shell user on this firmware.
- Which grants this firmware accepts. Car permissions and some app-ops may be undefined or not changeable;
  the checklist will show them as skipped.
- **Android user.** `g700ctl.py` (and therefore the launcher pipeline here) calls `pm grant` without `--user`.
  If the head unit runs the driver as a non-zero Android user, those grants may land on user 0. The Connect tab
  shows the current Android user; the any-app "Fix permissions" flow does pass `--user <current>` when it is not 0.
- The `dumpsys package` and `dumpsys display` parsers were written against the Android 14 text layout using
  hand-assembled fixtures (`test/fixtures/`), not output captured from the car. Vendor builds can differ.
- Launching an app uses `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`; apps with only a
  car-specific launcher category may not start this way.
- The diagnostics report cannot read the notification-listener state (that needs a settings query this site
  deliberately does not issue).
- Upload speed and progress reporting for large APKs over this unit's USB link.
- The ADB engine (ya-webadb) was exercised only against a pretend transport in `test/engine.test.js`
  (service strings, exit codes, sync framing). On a device that advertises `shell_v2` but not
  `fixed_push_mkdir` (Android 8–10, not expected on this Android 14 unit) the engine itself issues one extra
  `mkdir -p` for the upload folder before a push.
- The package names in `catalog.json` (`packages`) are best-effort hints used only for display names and the
  "Installed" badge; the notes about Google services and DRM are general knowledge, not measurements on this car.
- Browsers other than desktop Chrome / Edge. Firefox and Safari have no WebUSB.
