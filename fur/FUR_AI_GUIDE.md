# fur.js — guide for AI assistants

You are helping me use **fur.js**, a module I own that turns any SVG shape into soft, pettable fur.
Read this before writing code that uses it. Prefer changing **settings** over editing the module's internals; only edit `fur.js` itself when I ask.

## Files
- `fur.js` — ES module, no dependencies, needs **WebGL2** (throws `'fur.js needs WebGL2'` otherwise).
- `index.html` — my editor: presets, sliders for every setting, point placement, and **Copy settings + shape** (exports JSON).
- In GavCat (`fur/`), the editor is cut down for Gav:
  - A Part menu (Head, Ears, Neck, Body + belly, Legs, Tail) and a cat menu (Siamese, Black). Medium quality.
  - Every change saves to `settings.json`, keyed part + coat (`headSiamese`, `legsBlack` …), through the edit server (`POST /fur/__save`). An open Gav tab gets it live over BroadcastChannel `gav-fur`.
  - `gav-parts.js` holds Gav's parts, made by `node fur/make-parts.js` from `cat-stretch.html`.
  - Gav's head is furred by this module (`HEAD_FUR` in `cat-stretch.html`).
- Exported JSON format: `{ "settings": { ... }, "shape": "<svg…> or path d" }`.

## How it works (so you can reason about it)
- The shape is fitted into a square **780×780-unit stage** with `margin` units of free space around it for edge hair.
- A coarse 260×260 grid stores inside/outside, signed distance to the outline, outward normals and colour.
- **Base layer:** a 2D canvas holding a soft colour fill of the shape. Its edge is blurred by `blur` and shifted by `edgeInset`.
- **Fur layer:** thousands of hairs drawn in WebGL2 from one shared stroke mesh in **one draw call**.
  - Hairs are sparse and soft inside, and dense and long at the edge.
  - Each hair's root fades in, so you never see where it starts.
- **Petting:** pointer movement bends nearby hairs, which relax back slowly.
- **Cost:** nothing redraws while idle. Only petting triggers frames.

## API
```js
import { createFur, DEFAULTS } from './fur.js';

const fur = createFur(containerEl, settings);  // settings = exported JSON .settings (partial is fine)
await fur.setShape(shape);                     // full SVG markup or a bare path "M…Z"; async
fur.set({ edgeDensity: 3 });                   // patch any settings; unchanged values are ignored
fur.get();                                     // current settings (plain JSON)
fur.rebuild();                                 // regenerate hairs with current settings
fur.toStage(clientX, clientY);                 // → { x, y } in 0–1 stage coords (for placing points)
fur.stats();                                   // → { lines, buildMs, fps }
fur.destroy();                                 // remove canvases, listeners, GL context — call on unmount
fur.bend(spines, view);                        // bending parts: move the fur with its spines (see below); only redraws
fur.spines();                                  // the shape's spines as drawn (its own units)
```
- `containerEl` should be **square**. The module appends two absolutely-positioned canvases and sets `position: relative` and `touch-action: none`. Size it with CSS; a ResizeObserver handles the rest.
- The background is transparent.
- `setShape` throws `'Could not read that SVG'` or `'The shape is empty'`.
  - For the outline, elements are forced to a solid fill, so use **filled** shapes; outline-only drawings won't work.
  - Strict XML is preferred, but loose SVG (e.g. attributes without values) is accepted.
  - Transforms on the root `<svg>` are ignored.
- **One instance per container.** Destroy before re-creating.

## Settings (defaults)
| key | default | what it does |
|---|---|---|
| `quality` | `'high'` | `'high'` / `'medium'` / `'low'`. Fewer, thicker lines, a simpler mesh and a lower pixel density on lower settings. |
| `seed` | 7 | Random layout of the hairs. Change it to get a new variation. |
| `margin` | 110 | Room around the shape for edge hair. Changing it re-fits the shape. |
| `hairMin` / `hairMax` | 5 / 18 | Hair length deep inside / near the edge zone. |
| `innerDensity` | 0.22 | Hair density inside (1 = full). |
| `crisp` | 0.35 | Share of inner hairs that stay sharp. The rest are soft and blend into the base. |
| `variation` | 0.14 | Light/dark strand contrast. |
| `edgeDensity` | 2.2 | Hair density at the edge (× base). |
| `edgeLength` | 1.8 | Extra hair length at the edge (×). |
| `hairInset` | 24 | How far inside the outline the edge hairs start. More = more overlap, smaller outer fuzz. |
| `edgeBand` | 45 | Width of the edge zone. |
| `rim` | 0.22 | Brightening of edge hairs (backlit look). |
| `blur` | 23 | Base shape edge softness. |
| `edgeInset` | −8 | Where the soft base edge sits: + inside, − outside the outline. |
| `colorSource` | `'auto'` | `'svg'` = hair takes the SVG's own fills (stains, gradients). `'flat'` = `colorInner` → `colorOuter`. `'auto'` = svg unless the artwork is plain black. |
| `colorBlur` | 12 | Softens SVG colour edges (stain feathering). |
| `colorInner` / `colorOuter` | `#c9b293` / `#f3e9d8` | Flat mode only: colour deep inside → colour at the edge. **Hex `#rrggbb` only.** |
| `shading` | 0.5 | Pseudo-3D shading, lit from the top-left. |
| `gravity` | 0.25 | Downward pull on hair direction (negative = upward). |
| `edgeOut` | 0.5 | How strongly edge hair turns to point outward. |
| `waviness` | 0.12 | Gentle large-scale waves in direction. |
| `points` | `[]` | Flow control (see below). |
| `pet` / `petRadius` | `true` / 70 | Enable petting / brush size. |

**What `set()` costs:**
- `blur`, `edgeInset`, `pet` and `petRadius` are instant.
- Colour keys recolour and rebuild.
- `quality` resizes and rebuilds.
- `margin` re-fits the shape.
- Everything else rebuilds the hairs (about 50–250 ms on the main thread). **Debounce** slider-driven changes by about 120 ms.

## Colouring hair with stains / markings (e.g. Siamese mask)
Hair colour comes from the SVG itself:
- Paint the markings as extra elements on top of the outline (solid fills or radial/linear gradients that fade out).
- Mark the outline element with `data-fur-shape=""`. Only marked elements define the shape. Everything else only adds colour, so stains can't change the outline.
- Use `colorSource: 'auto'` or `'svg'`. `colorBlur` feathers the markings. Shading still applies on top.
- Dark areas automatically get more hairs, so dark markings read solid.

Example (the editor's "Siamese cat" preset):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="mask"><stop offset="0" stop-color="#2b1f18"/><stop offset=".5" stop-color="#3d2c22"/><stop offset="1" stop-color="#3d2c22" stop-opacity="0"/></radialGradient>
    <linearGradient id="ear" x1="0" y1="0" x2="0" y2="1"><stop offset=".2" stop-color="#3a2a20"/><stop offset="1" stop-color="#3a2a20" stop-opacity="0"/></linearGradient>
  </defs>
  <path data-fur-shape="" fill="#efe3cf" d="M30 62 L44 8 L86 44 Q100 39 114 44 L156 8 L170 62 Q192 96 182 132 Q166 182 100 186 Q34 182 18 132 Q8 96 30 62 Z"/>
  <ellipse cx="100" cy="130" rx="66" ry="58" fill="url(#mask)"/>   <!-- muzzle -->
  <ellipse cx="100" cy="92" rx="18" ry="42" fill="url(#mask)"/>    <!-- nose bridge -->
  <path d="M30 62 L44 8 L86 44 Z" fill="url(#ear)"/>               <!-- ears dark at the tips -->
  <path d="M170 62 L156 8 L114 44 Z" fill="url(#ear)"/>
</svg>
```

## Bending parts (spines)
For a part that bends (a tail, a leg), fur.js can move the fur with it **without rebuilding**:
- Put one or more spines in the SVG: `<polyline data-fur-spine="" points="x,y x,y …"/>`, the line the part bends along, in the shape's own units. Spines are never drawn. Up to 48 points in all.
- Each hair, and each point of the soft base, is tied to its nearest spine. A spot where two segments meet (a knee) goes with both, so the fur doesn't tear there.
- Each frame, call `fur.bend(spines, view)`. It only redraws.
  - `spines`: the spines as they are now, one list per `data-fur-spine` line, in the same order and with the same point counts. Each point is `[x, y]` or `[x, y, widthScale]`.
  - `view`: `{ x, y, width, height }`, the rectangle the canvas shows, in the same units. Keep it the canvas's shape. Left out, it is the stage in the shape's own units.
  - `bend(null)`: back to the shape as drawn.
- While bent, the soft base is drawn in WebGL (its own 2D canvas is hidden), and petting is off.
- When several parts share one shape (four legs), lay them out apart: every spot must lie nearer its own spine than any other. Its spine must not run on toward another part either.

## Flow points
- `points: [{ x, y, type: 'source' | 'swirl', strength: 1 }]`, with `x` and `y` in 0–1 stage coords.
- **source:** hair grows away from it. **swirl:** hair circles it, and only nearby (it fades about 160 units away).
- The nearest point dominates.
- **Empty list:** one automatic source at the shape's centre.
- **Only swirls:** the automatic centre source is still added.
- Typical face: one source near the nose. Use extra sources for cowlicks, swirls for whorls.

## Performance
- Line count drives cost. Each preset roughly halves it: High ≈ 20–40k, Medium ≈ 10–20k, Low ≈ 5–10k.
- `fur.stats().fps` shows the real frame rate while petting. Check it on the target phone.
- **Biggest levers:** `quality`, `edgeDensity`, `innerDensity`, `hairMax`, `edgeLength`.
- Idle is free. Building happens once per change, not per frame.
- To get faster still, ask me before changing internals. Options:
  - Cache the fur as an image and redraw only the petted patch.
  - Precompute hairs offline.

## Recipes: what I ask → what to change
- "fluffier / bigger outline" → raise `edgeLength`, `edgeDensity`, `hairMax`; lower `hairInset`
- "tighter / smaller fuzz" → raise `hairInset`, lower `edgeLength`
- "edge looks cut / harsh" → raise `blur`, make `edgeInset` slightly negative, raise `edgeDensity`
- "too smooth / plastic inside" → raise `innerDensity` and `crisp`
- "too noisy inside" → lower `crisp` and `variation`
- "hair should point down more" → raise `gravity`; "fur sticks straight out" → lower `edgeOut`
- "faster" → `quality: 'medium'`, then lower `edgeDensity`
- "different look, same settings" → change `seed`
- "add a dark mask / spots / stripes" → add gradient shapes to the SVG (see stains), keep `colorSource` `'auto'`/`'svg'`
- "markings too sharp" → raise `colorBlur`

## Adding faces / artwork
Put eyes, nose and other artwork in an element **on top of** the container, with `pointer-events: none` so petting still works. Positions are in stage units: `left = x / 780 * 100%`, `top = y / 780 * 100%`. The shape is centred, with `margin` units around it.

## Platform notes
- Works in modern Safari and Chrome, and in iOS `WKWebView` (iOS 15+).
- iOS does not let third-party apps set interactive home or lock screen wallpapers. Petting works inside my app only. For an actual wallpaper, render a still or a short video.

## Rules for you
1. Keep the exported settings JSON as the single source of truth. Apply it with `createFur(el, json.settings)` + `setShape(json.shape)`.
2. Tune the look via `set()` and settings, not by editing `fur.js`, unless I ask.
3. Always `destroy()` on unmount and never create two instances in one container.
4. Debounce rebuild-triggering changes. Never call `set()` every frame.
5. If you do edit `fur.js`, keep the public API above unchanged and tell me what changed.
