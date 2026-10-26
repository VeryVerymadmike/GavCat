# Gav

SVG + JS cat animation in one file.

- `cat-stretch.html` — source. Open in Safari/any browser.
- `index.html` — GitHub Pages copy. Rebuild: `./build.sh`
- `tools/` — Python Playwright test scripts (smoke, gait/jump checks, `bake_in.py`). They expect the page served at `http://127.0.0.1:8765/`.

## App (iPhone, iPad, Mac)

`GavCat.xcodeproj` wraps `index.html` in a WKWebView (Xcode 16+).

1. Open `GavCat.xcodeproj`.
2. Target Gav → Signing & Capabilities → pick your Team.
3. Pick a destination (My Mac or an iPhone) → Run.

After editing `cat-stretch.html`, run `./build.sh` so the app gets the new `index.html`.
