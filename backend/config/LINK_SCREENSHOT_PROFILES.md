# Link Screenshot Profiles

Deprecated location.

Source of truth moved to: `VBAUT/screenshot-engine/config/link-screenshot-profiles.json`.

Purpose:
- define default screenshot size and zoom for link preview screenshots;
- override zoom by source domain groups.

Current behavior:
- screenshot size is taken from `defaults.width` and `defaults.height`;
- zoom is taken from `defaults.zoom` unless host matched in a `zoom_<N>` group;
- host match is by domain (`www` ignored, subdomains are supported).

Example:
- `https://www.rbc.ru/...` matches `https://www.rbc.ru/` in `headlines.zoom_300`;
- result: `width=1920`, `height=960`, `zoom=300`.
