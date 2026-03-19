# Screenshot Engine

Portable screenshot module for link previews.

## What Is Inside

- `link-screenshot.js` - headless browser capture script.
- `cookie-utils.js` - parser for JSON/Netscape cookies.
- `config/link-screenshot-profiles.json` - domain zoom profiles.
- `config/LINK_SCREENSHOT_PROFILES.md` - profile format notes.

## Install

```bash
cd screenshot-engine
npm install
```

## Run (CLI)

```bash
node link-screenshot.js --url "https://www.rbc.ru/" --width 2560 --height 1280 --zoom 300 > out.png
```

With cookies:

```bash
node link-screenshot.js --url "https://x.com/..." --cookies_path "./cookies/x.json" > out.png
```

## Persistent Browser (VBAUT Backend)

When backend starts, it can auto-launch a persistent Chromium profile for Screenshot Lab manual sessions.

Set in `backend/.env`:

```env
SCREENSHOT_BROWSER_ENABLED=1
SCREENSHOT_BROWSER_AUTOSTART=1
SCREENSHOT_BROWSER_HEADLESS=1
SCREENSHOT_BROWSER_MODE=launch
SCREENSHOT_BROWSER_PROFILE_DIR=C:\tgbotapi\VBAUT\data\screenshot-browser-profile
SCREENSHOT_BROWSER_DEBUG_PORT=9223
SCREENSHOT_BROWSER_CONNECT_HOST=127.0.0.1
SCREENSHOT_BROWSER_CONNECT_PORT=9223
SCREENSHOT_BROWSER_EXECUTABLE_PATH=
SCREENSHOT_BROWSER_EXTENSIONS=
SCREENSHOT_BROWSER_EXTRA_ARGS=
```

Notes:
- Logins/cookies stay in `SCREENSHOT_BROWSER_PROFILE_DIR` between restarts.
- In `launch` mode backend tries to use installed Google Chrome (auto-detect) to reduce login blocks.
- `SCREENSHOT_BROWSER_EXTENSIONS` supports multiple paths separated by `;`, `,` or new lines.
- `SCREENSHOT_BROWSER_EXECUTABLE_PATH` lets you use your own Chrome/Chromium build.
- `SCREENSHOT_BROWSER_HEADLESS=1` is default and runs invisible (headless) in `launch` mode.
- `SCREENSHOT_BROWSER_HEADLESS=0` shows browser windows for debugging/manual control.

Auto screenshot via persistent profile (for selected domains):

```env
SCREENSHOT_PERSISTENT_CAPTURE_ENABLED=1
SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS=*
SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS=1400
SCREENSHOT_LAB_MANUAL_FORCE_HEADED=1
```

This lets `/api/link/screenshot` reuse the same logged-in profile (instead of isolated headless cookie file flow) for these domains.
Use `*` (or `all`) to force persistent capture for every site.
`SCREENSHOT_LAB_MANUAL_FORCE_HEADED=1` temporarily restarts persistent browser in visible mode for Manual (same profile/logins), then switches back to headless after Manual stop.

To run with Prime instead of Chrome, set binary path:

```env
SCREENSHOT_BROWSER_EXECUTABLE_PATH=C:\Path\To\Prime\prime.exe
```

### Connect To Already Open Chrome (recommended for strict sites)

If Google/X blocks login in automation mode, run your own Chrome manually and let backend connect to it:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\tgbotapi\VBAUT\data\screenshot-browser-profile"
```

Then use:

```env
SCREENSHOT_BROWSER_MODE=connect
SCREENSHOT_BROWSER_CONNECT_HOST=127.0.0.1
SCREENSHOT_BROWSER_CONNECT_PORT=9223
```

## Screenshot Lab Standalone

You can run Screenshot Lab without the main frontend:

```bash
cd VBAUT
npm run dev:screenshot-lab
```

Default URL:

```text
http://localhost:8790/tools/screenshot-lab
```

Port is configurable via `SCREENSHOT_LAB_PORT`.

## Retina (macOS)

- For denser output, increase `--width/--height` (for example `3840x1920`) and keep the same `--zoom`.
- Default working canvas is `2560x1280` (2:1) for Screenshot Lab and auto screenshot mode.

## Notes

- The script has anti-popup cleanup, ad/tracker request filtering, and anti-bot page detection.
- Some sites can still return anti-bot pages; in this case backend should fallback or skip screenshot.
- Manual sessions now try persistent profile first; if unavailable they fallback to ephemeral browser mode.
