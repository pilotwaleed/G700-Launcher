# Third-party components in web-installer

## Bundled JavaScript — `vendor/adb-engine.bundle.js`

Built once with esbuild (`npm run build:engine`, entry `scripts/engine-entry.mjs`) from the Tango ADB /
ya-webadb packages. All are MIT-licensed, Copyright (c) 2020-2025 Simon Chan and contributors,
https://github.com/yume-chan/ya-webadb.

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| `@yume-chan/adb` | 2.6.4 | MIT | ADB protocol, shell and sync services |
| `@yume-chan/adb-daemon-webusb` | 2.3.2 | MIT | WebUSB transport |
| `@yume-chan/adb-credential-web` | 2.1.0 | MIT | Browser key store (WebCrypto + IndexedDB) |
| `@yume-chan/stream-extra` | 2.6.1 | MIT | Stream helpers (dependency) |
| `@yume-chan/struct` | 2.3.2 | MIT | Binary struct helpers (dependency) |
| `@yume-chan/async` | 4.2.2 | MIT | Promise helpers (dependency) |
| `@yume-chan/event` | 2.0.0 | MIT | Event helpers (dependency) |
| `@yume-chan/no-data-view` | 2.0.0 | MIT | Byte helpers (dependency) |

Licence text as shipped in the packages:

```
MIT License

Copyright (c) 2020-2025 Simon Chan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Build-time only (not shipped)

| Package | Version | Licence |
| --- | --- | --- |
| `esbuild` | 0.28.2 | MIT |

## Fonts — `fonts/`

| File | Family | Licence |
| --- | --- | --- |
| `IBMPlexSansArabic-Regular.ttf`, `-Medium.ttf`, `-SemiBold.ttf` | IBM Plex Sans Arabic (includes the Latin glyphs used here) | SIL Open Font License 1.1 — `fonts/OFL-IBM-Plex-Sans-Arabic.txt`. Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". |

The font files are copies of the ones the app already bundles (`design/src/main/res/font/plex_arabic_*.ttf`);
the licence text is a copy of `third_party/fonts/OFL-IBM-Plex-Sans-Arabic.txt`.

## Not used

No code, text, styles or structure were taken from any other installer project. The site makes no request to
any third-party host at run time.
