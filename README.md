# Gav

SVG + JS cat animation in one file.

- `cat-stretch.html` — source. Open in Safari/any browser.
- `index.html` — GitHub Pages copy. Rebuild: `./build.sh`
- Tuning: `python3 tools/edit_server.py`, open `http://127.0.0.1:8766/` and use the panel. Every change is written into `cat-stretch.html` and `index.html` (the panel shows **Saved**), so it shows up in git and in the app.
- `tools/` — Python Playwright test scripts (smoke, gait/jump checks, `bake_in.py`). They expect the page served at `http://127.0.0.1:8765/`.

## App (iPhone, iPad, Mac)

`GavCat.xcodeproj` wraps `index.html` in a WKWebView (Xcode 16+).

1. Open `GavCat.xcodeproj`.
2. Target Gav → Signing & Capabilities → pick your Team.
3. Pick a destination (My Mac or an iPhone) → Run.

After editing `cat-stretch.html`, run `./build.sh` so the app gets the new `index.html`.

On the Mac, Gav is the desktop wallpaper: a see-through window behind the desktop icons that clicks pass through, with a
cat in the menu bar (Reload, Quit). It loads the GitHub Pages site (`https://veryverymadmike.github.io/GavCat/?wallpaper`,
so it follows `main`; Reload after a push) and falls back to the bundled `index.html` when offline. It reads the cursor
itself and passes it to the page while it is over the bare desktop, so the cat reacts to the mouse without Plash's
Browsing Mode. The wallpaper never shows the controls: edit in a browser (`tools/edit_server.py`) and push.
