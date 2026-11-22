# fur.js — guide for AI assistants

You are helping me use **fur.js**, a module I own that turns any SVG shape into soft, pettable fur.
Read this before writing code that uses it. Prefer changing **settings** over editing the module's internals; only edit `fur.js` itself when I ask.

## Files
- `fur.js` — ES module, no dependencies, needs **WebGL2** (throws `'fur.js needs WebGL2'` otherwise).
- `index.html` — my editor: presets, sliders for every setting, point placement, and **Copy settings + shape** (exports JSON).
- In GavCat (`fur/`), the editor is Gav himself (since 2026-11-19): the cat page in an iframe (`../?wallpaper&furpage`: the project's cat, zoomed in, never saves), so what it shows is what the cat shows.
  - One set of sliders: a moved value is saved into every part of the coat (head, ears, body, legs, fullBody, tail; the inner ears keep their own). Coat menu, Full body fur toggle (`options.fullBody`), Pose menu (Gav's poses via `catDebug.pose`).
  - Move: the body, legs and tail spines show as dots; dragging one only bends the fur to look (`catDebug.furEdit`, never saved; a body dot takes the legs and tail along). Flow points (source only) show on the cat as drawn and can be added, dragged, removed; each lands in the part whose drawing it is on (`catDebug.furMap`). Move gradient places the inner ears' gradients (`glow` / `glowSize` in `innerEarsSiamese`, `ear-glow.js`).
  - Every change saves to `settings.json`, keyed part + coat, through the edit server (`POST /fur/__save`), and goes to every open cat page over BroadcastChannel `gav-fur`.
  - `gav-parts.js` holds Gav's parts, made by `node fur/make-parts.js` from `cat-stretch.html` (the edit server runs it after saves).
  - Each part keeps its own flow points even where it takes another part's values (the legs under Full body fur).
  - Fur follows Gav's layer controls: legs behind the body, over it, or over the head (a fur layer above the SVG), the tail by its layer.
- Exported JSON format: `{ "settings": { ... }, "shape": "<svg…> or path d" }`.

## How it works (so you can reason about it)
- The shape is fitted into a square **780×780-unit stage** with `margin` units of free space around it for edge hair.
- A coarse 260×260 grid stores inside/outside, signed distance to the outline, outward normals and colour.
- **Base layer:** a 2D canvas holding a soft colour fill of the shape. Its edge is blurred by `blur` and shifted by `edgeInset`.
  - It is painted at 520×520 (twice the 260 grid), its edge from the drawing's own anti-aliased outline, so a low `blur` gives a clean edge, not stair steps (2026-11-19).
  - Its colour is as bright as the hairs over it are on average (`variation` and `rim` lighten the hairs), so where the hair is thinner (inside, or stretched as a part bends) no darker patch shows. Added 2026-11-19, after a bent body showed its thinner middle as a darker triangle.
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
fur.bend(spines, view, floor);                 // bending parts: move the fur with its spines (see below); only redraws
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
| `hairInset` | 24 | How far inside the outline the edge hairs start. More = more overlap, smaller outer fuzz. Below 0, the fur starts that far outside the outline (fatter). Gav's fur page shows it as **Fur outset**, 0 to 15 (= hairInset 0 to −15); at 15 a leg looks about 30% fatter. |
| `edgeBand` | 45 | Width of the edge zone. |
| `rim` | 0.22 | Brightening of edge hairs (backlit look). |
| `rimSpread` | 0 | 0: `rim` only in the edge band, brightening the colour (old behaviour); else the shape is lit as a rounded body (curving away over rimSpread units from the outline), from above and a little in front with `rimTop` (top of a body most, a leg's or tail's middle softly, nothing underneath), blurred so no seam shows. That light mixes the colour toward white by `rim` at most, so pale fur doesn't clip and dark fur gets a sheen. Added 2026-11-22. |
| `rimTop` | 0 | 0: `rim` all round the outline; 1: only where the outline faces up (the shape's own up), none where it faces less than about 12° above level. Gav always uses 1 (added 2026-11-22). |
| `blur` | 23 | Base shape edge softness. |
| `edgeInset` | −8 | Where the soft base edge sits: + inside, − outside the outline. |
| `keepShape` | `false` | Keeps the soft base from shrinking inside the shape: a number is how far inside the outline it may end at most (units; `true` = 0, solid right up to the outline), whatever `edgeInset` says; it can still fade out past it. Added 2026-11-11; Gav's parts use it (the fur page's "Most inset", 6 unless set). |
| `unit` | `false` | Makes the sizes the same on every part, however each shape is fitted into the stage. Covers hair length and width, `hairInset`, `edgeBand`, `blur`, `edgeInset`, `keepShape`, `colorBlur`, the flow's reach and the waviness. A number is the stage units per shape unit the sizes are meant at; each size is scaled by the shape's fit ÷ `unit`. A small part fitted large gets finer hair, and more of it. Added 2026-11-12. Gav and the fur page pass it, not saved: 5.05 per body unit (the head's fit), and for the head × its scale in `gav-parts.js`. |
| `colorSource` | `'auto'` | `'svg'` = hair takes the SVG's own fills (stains, gradients). `'flat'` = `colorInner` → `colorOuter`. `'auto'` = svg unless the artwork is plain black. |
| `colorBlur` | 12 | Softens SVG colour edges (stain feathering). |
| `colorInner` / `colorOuter` | `#c9b293` / `#f3e9d8` | Flat mode only: colour deep inside → colour at the edge. **Hex `#rrggbb` only.** |
| `shading` | 0.5 | Pseudo-3D shading, lit from the top-left. |
| `gravity` | 0.25 | Downward pull on hair direction (negative = upward). |
| `edgeOut` | 0.5 | How strongly edge hair turns to point outward. |
| `waviness` | 0.12 | Gentle large-scale waves in direction. |
| `invert` | `false` | Inverted edge: edge hairs root *outside* the outline (`hairInset` to `hairInset + edgeBand` out, only where the SVG paints round the shape) and lie in over it, coloured by what is painted there; the shape keeps only its inner hairs, which end at the outline. For a part that sits inside another (an inner ear). |
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
- Several parts in one shape (Gav's full body): mark the main part's spine `data-fur-hub=""`. Fur where another part meets it (a leg, the neck) follows both spines, blended, and the soft base between them stretches like skin instead of tearing. Two non-hub parts (two legs) never join. Added 2026-11-19.
- `data-fur-reach="r"` on a spine (shape units): spots count as that much nearer to it. A body whose spine runs along its back gets its hip and shoulder circles' size as reach, so it owns the whole body and the legs take over only below. Past the spine's ends the reach fades out quickly, so a neck growing from there stays its own.
- The fur bends along a smooth curve through each spine's points (Catmull-Rom, its end points mirrored), not along straight segments, so a spine bent at its points bends the fur round instead of at corners (2026-11-19).
- Each hair, and each point of the soft base, goes with up to four spine segments, shared out by how near each is. The shares change smoothly from spot to spot (a segment coming in or going out starts at 0), so neighbouring fur always moves together: no seams at knees, along a bending body, or where a leg meets it. (Until 2026-11-19 a spot followed only its nearest segment and one partner; where the partner switched, the fur split into slits.)
- Each frame, call `fur.bend(spines, view)`. It only redraws.
  - `spines`: the spines as they are now, one list per `data-fur-spine` line, in the same order and with the same point counts. Each point is `[x, y]` or `[x, y, widthScale]`.
  - `view`: `{ x, y, width, height }`, the rectangle the canvas shows, in the same units. Keep it the canvas's shape. Left out, it is the stage in the shape's own units.
  - `bend(null)`: back to the shape as drawn.
  - `bend(spines, view, floor)`: `floor` is optional, a y in view units. A hair that would go below it is pressed flat along it, spreading sideways. The soft base is cut there. Added 2026-11-18; Gav passes his floor line.
  - `bend(spines, view, floor, z)`: `z` is optional, one number per spine, higher in front. Where parts cross, each part's fur lies over or under another's as a whole, instead of the hairs mixing. A part drawn over others first lays its solid inside over them (fading out where it joins them). Left out, the hub is at the back and the rest in order. Added 2026-11-19; Gav passes his layer controls (the body at zbelly, each leg at its own).
  - Where the soft base folds over itself (a tight curl, a leg bent up against the belly), each pixel keeps the more solid of the two (max blending), so the fold shows as a soft crease, not a hard edge. (A depth-test version gave straight hard edges; squeezing the inside of a bend opened a gap instead.)
- While bent, the soft base is drawn in WebGL (its own 2D canvas is hidden), and petting is off.
- When several parts share one shape (four legs), lay them out apart: every spot must lie nearer its own spine than any other. Its spine must not run on toward another part either.

## Flow points
- `points: [{ x, y, type: 'source' | 'swirl', strength: 1 }]`, with `x` and `y` in 0–1 stage coords.
- **source:** hair grows away from it. **swirl:** hair circles it, and only nearby (it fades about 160 units away).
- The nearest point dominates.
- **Empty list:** one automatic source at the shape's centre.
- **Only swirls:** the automatic centre source is still added.
- **A shape in separate pieces** (four legs, two ears): each piece follows only the points nearest it. A piece with no points of its own borrows the nearest piece's, moved to the same place on its own box, so one point above one leg works for every leg. With no points at all, each piece gets its own centre source.
- Specks under about 40 grid cells join the nearest real piece.
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

- `data-fur-short` (added 2026-11-22): like `data-fur-fade`, a grey picture in the shape, white where the hairs are shortest (up to 75% shorter, by how white). Gav's head puts a soft oval at the chin so the fur lies closer there.
- `pawFold` (added 2026-11-22, default false): each spine's last joint (a paw's wrist / ball) creases from 45° to 95° instead of 158° to 175°, so a paw turned against its leg takes the fur past the leg's end with it. Gav's leg fur uses it.
