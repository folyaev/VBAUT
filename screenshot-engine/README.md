# Screenshot Engine

Standalone screenshot module for link previews.

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

## Run

```bash
node link-screenshot.js --url "https://www.rbc.ru/" --width 1920 --height 960 --zoom 300 > out.png
```

With cookies:

```bash
node link-screenshot.js --url "https://x.com/..." --cookies_path "./cookies/x.json" > out.png
```

## Retina (macOS)

- For denser output, increase `--width/--height` (for example `3840x1920`) and keep the same `--zoom`.
- Or keep `1920x960` if you need exact UI size parity with the project preview cards.

## Notes

- The script has anti-popup cleanup, ad/tracker request filtering, and anti-bot page detection.
- Some sites can still return anti-bot pages; in this case backend should fallback or skip screenshot.
