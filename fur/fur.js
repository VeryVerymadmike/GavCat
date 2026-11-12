// fur.js — furry fill for any SVG shape.
// One shared stroke mesh drawn as instanced lines (WebGL2, 1 draw call) over a soft colour base.
// Idle = zero work; only petting redraws.
//
//   import { createFur } from './fur.js';
//   const fur = createFur(document.getElementById('cat'), settings);
//   await fur.setShape('<svg>…</svg>' or 'M10 10 L…Z');
//   fur.set({ edgeDensity: 3 });
//
// Bending parts (a tail, a leg): give the shape one or more spines, <polyline data-fur-spine="" points="x,y x,y …"/>,
// the lines it bends along (not drawn). Each hair (and the soft base) is tied to its nearest spine, so
//   fur.bend([[[x, y], [x, y], …], …], view);   // the spines as they are now → only a redraw, no rebuild
// moves the fur with them. null = back to the shape as drawn.

const SVGNS = 'http://www.w3.org/2000/svg';
const MAXP = 48;                 // spine points in all, at most

export const DEFAULTS = {
  quality: 'high',          // 'high' | 'medium' | 'low'
  seed: 7,
  margin: 110,              // room around the shape for edge hair (stage is 780×780 units)
  // fur
  hairMin: 5,               // hair length deep inside
  hairMax: 18,              // hair length near the edge zone
  innerDensity: 0.22,       // line density inside (1 = full)
  crisp: 0.35,              // share of inner lines kept sharp (rest are soft and blend)
  variation: 0.14,          // light/dark strand variation
  // edge
  edgeDensity: 2.2,         // line density at the edge (× base)
  edgeLength: 1.8,          // extra hair length at the edge (×)
  hairInset: 24,            // hair outline pulled inside the shape (units)
  edgeBand: 45,             // width of the edge zone (units)
  rim: 0.22,                // edge hair brightening
  // base: soft shape under the fur
  blur: 23,                 // shape edge blur (units)
  edgeInset: -8,            // + inside / − outside the outline
  // colour
  colorSource: 'auto',      // 'auto' | 'svg' (use the SVG's own fills: stains, gradients) | 'flat' (inner → outer)
  colorBlur: 12,            // softens SVG colour edges (units)
  colorInner: '#c9b293',
  colorOuter: '#f3e9d8',
  shading: 0.5,             // pseudo-3D light from top-left
  // flow
  gravity: 0.25,            // downward pull on hair direction
  edgeOut: 0.5,             // how much edge hair turns to point outward
  waviness: 0.12,
  invert: false,            // edge hairs grow from outside the outline (where the SVG paints round it) and lie in over the shape
  unit: false,              // false, or the stage units per shape unit the sizes below are meant at: then every part shows them the same size, however it is fitted in
  keepShape: false,         // false, or how far inside the outline the soft base may end at most (units; true = 0, right at it), whatever edgeInset says
  points: [],               // [{ x, y (0–1 of stage), type: 'source' | 'swirl', strength: 1 }]; empty = auto (centre)
  // petting
  pet: true,
  petRadius: 70,
};

const QUALITY = {
  high:   { cover: 1.0,  hw: 1.0, seg: 4, dpr: 2 },
  medium: { cover: 0.65, hw: 1.4, seg: 3, dpr: 2 },
  low:    { cover: 0.5,  hw: 2.0, seg: 2, dpr: 1.5 },
};
const BASE_KEYS = new Set(['blur', 'edgeInset', 'keepShape']);
const COLOR_KEYS = new Set(['unit', 'colorInner', 'colorOuter', 'shading', 'colorSource', 'colorBlur', 'invert']);
const LIVE_KEYS = new Set(['pet', 'petRadius']);

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const seeded = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hex = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

function boxBlur(a, w, h, r) {                       // separable box blur, RGBA floats, in place
  const t = new Float32Array(a.length), n = 2 * r + 1;
  for (const [src, dst, horiz] of [[a, t, 1], [t, a, 0]]) {
    const lines = horiz ? h : w, len = horiz ? w : h;
    const at = (l, i) => (horiz ? l * w + clamp(i, 0, w - 1) : clamp(i, 0, h - 1) * w + l) * 4;
    for (let l = 0; l < lines; l++) for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[at(l, i) + c];
      for (let i = 0; i < len; i++) { dst[at(l, i) + c] = acc / n; acc += src[at(l, i + r + 1) + c] - src[at(l, i - r) + c]; }
    }
  }
}
function chamfer(d, near, GN) {                      // 2-pass 8-neighbour distance transform
  const n = GN * GN, F = [[-1, 0, 1], [-1, -1, 1.414], [0, -1, 1], [1, -1, 1.414]];
  for (const dir of [1, -1]) for (let k = 0; k < n; k++) {
    const i = dir > 0 ? k : n - 1 - k, x = i % GN, y = i / GN | 0;
    for (const [dx, dy, w] of F) {
      const xx = x + dx * dir, yy = y + dy * dir;
      if (xx < 0 || yy < 0 || xx >= GN || yy >= GN) continue;
      const j = yy * GN + xx;
      if (d[j] + w < d[i]) { d[i] = d[j] + w; if (near) near[i] = near[j]; }
    }
  }
}

/* ---------- shaders ---------- */
// a spot tied to a spine (segment i, t along it, offsets e along and d across it, all as drawn) on the spine as it is now
// (u_sp: x, y, width scale, 1 = first point of its spine | 2 = last), in view units: position, and the spine's direction there
const SPINE_GLSL = `
vec2 spTan(int k){ int f = int(u_sp[k].w + 0.5); int a = (f & 1) != 0 ? k : k - 1, b = (f & 2) != 0 ? k : k + 1;
  return normalize(u_sp[b].xy - u_sp[a].xy); }
vec3 spineAt(vec4 s){
  int i = int(s.x + 0.5); float t = s.y, tc = clamp(t, 0.0, 1.0);
  vec2 P = mix(u_sp[i].xy, u_sp[i + 1].xy, t), T = normalize(mix(spTan(i), spTan(i + 1), tc)), N = vec2(-T.y, T.x);
  float w = mix(u_sp[i].z, u_sp[i + 1].z, tc);
  return vec3(P + (T * s.z + N * s.w * w) * u_k, atan(T.y, T.x));
}`;
// the soft base when bent: a grid over the stage, each point tied to its spine, painted with the base picture
const VSB = `#version 300 es
layout(location=0) in vec2 a_pos;    // grid point (stage units)
layout(location=1) in vec4 a_sp;
layout(location=2) in vec4 a_sp2;
layout(location=3) in float a_w;
uniform float u_k; uniform vec4 u_view, u_sp[${MAXP}];
out vec2 v_uv;
${SPINE_GLSL}
void main(){
  vec2 q = mix(spineAt(a_sp).xy, spineAt(a_sp2).xy, a_w); v_uv = a_pos / 780.0;
  gl_Position = vec4((q.x - u_view.x) / u_view.z * 2.0 - 1.0, 1.0 - (q.y - u_view.y) / u_view.w * 2.0, 0.0, 1.0);
}`;
const FSB = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
void main(){ o = texture(u_tex, v_uv); }`;
const VS = `#version 300 es
layout(location=0) in vec2 a_tv;     // t along line (0 root → 1 tip), side (-1 | 1)
layout(location=1) in vec4 a_root;   // x, y, angle, length
layout(location=2) in vec4 a_shape;  // half width, bend, softness, root fade length
layout(location=3) in vec4 a_col;    // rgb, opacity
layout(location=4) in float a_off;   // petting offset (radians)
layout(location=5) in vec4 a_sp;     // on its spine: segment, t along it, offsets along / across it (stage units)
layout(location=6) in vec4 a_sp2;    // the same on the next nearest segment of that spine
layout(location=7) in vec3 a_sw;     // share of that one, and the drawn spine's direction at each
uniform float u_px, u_bent, u_k; uniform vec4 u_view, u_sp[${MAXP}];
out vec4 v_col; out float v_side; out float v_soft;
${SPINE_GLSL}
void main(){
  float t = a_tv.x, off = a_off, soft = a_shape.z;
  float ang  = a_root.z + off * 0.7;                          // root turns a little…
  float bend = a_shape.y + off * 0.8;                         // …tip bends more
  float len  = a_root.w * (1.0 - 0.25 * min(1.0, abs(off)));  // ruffled hair stands up → shorter
  vec2 c  = vec2(t * len, 0.5 * bend * len * t * t);
  vec2 tg = normalize(vec2(1.0, bend * t));
  float k = u_bent > 0.5 ? u_k : 1.0;                         // view units per stage unit
  float w = a_shape.x * (1.0 + 0.7 * soft) * (1.0 - t);
  float a = a_col.a * smoothstep(0.0, a_shape.w, t) * (1.0 - 0.35 * t) * (1.0 - 0.35 * soft); // root fades in
  float minW = 0.5 / (u_px * k);                              // never thinner than 1px: fade instead
  if (w < minW) { a *= w / minW; w = minW; }
  vec2 p = c + vec2(-tg.y, tg.x) * a_tv.y * w, r = a_root.xy;
  if (u_bent > 0.5) {                                         // bent: root and direction go with the spine
    vec3 f = spineAt(a_sp), g = spineAt(a_sp2);
    vec2 d = mix(vec2(cos(f.z - a_sw.y), sin(f.z - a_sw.y)), vec2(cos(g.z - a_sw.z), sin(g.z - a_sw.z)), a_sw.x);
    r = mix(f.xy, g.xy, a_sw.x); ang += atan(d.y, d.x);
  }
  float cs = cos(ang), sn = sin(ang);
  vec2 q = r + vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) * k;
  gl_Position = vec4((q.x - u_view.x) / u_view.z * 2.0 - 1.0, 1.0 - (q.y - u_view.y) / u_view.w * 2.0, 0.0, 1.0);
  v_col = vec4(a_col.rgb, a); v_side = a_tv.y; v_soft = soft;
}`;
const FS = `#version 300 es
precision highp float;
in vec4 v_col; in float v_side; in float v_soft; out vec4 o;
void main(){
  float g = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  float a = v_col.a * mix(0.78 + 0.22 * g, 1.0 - v_side * v_side, v_soft); // crisp: grain · soft: blurred edges
  o = vec4(v_col.rgb * a, a);
}`;

/* ---------- main ---------- */
export function createFur(container, options = {}) {
  const o = { ...DEFAULTS, ...options, points: [...(options.points || DEFAULTS.points)] };
  const W = 780, H = 780, GS = 3, GN = W / GS, NC = GN * GN;

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.style.touchAction = 'none';
  const mk = () => { const c = document.createElement('canvas');
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    container.appendChild(c); return c; };
  const baseCv = mk(), cv = mk();
  baseCv.width = baseCv.height = GN;
  const gl = cv.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('fur.js needs WebGL2');

  let rand, lastShape = null;
  let SVG_PX = null, LIGHT_PX = null, IN = null, SDF, NEAR, NX, NY, COL, BASE_RGB, DMAX = 1, CEN = { x: W / 2, y: H / 2 };
  // spines: as drawn (shape units, SPINES_SVG) and in stage units (SPINES; SP all their points, FLAG first/last, RT directions);
  // FIT: how the shape sits in the stage (stage = shape × s + t); BENT: the spines as they are now (see bend)
  let SPINES_SVG = [], SPINES = [], SP = [], SPID = [], FLAG = [], RT = [], FIT = { tx: 0, ty: 0, s: 1 }, BENT = null;
  const gi = (x, y) => { x = x / GS | 0; y = y / GS | 0; return x < 0 || y < 0 || x >= GN || y >= GN ? -1 : y * GN + x; };
  const Q = () => QUALITY[o.quality] || QUALITY.high;
  // sizes (hair length and width, insets, bands, blurs) are in stage units; with unit set they are meant at that fit, so scaled by how this shape is fitted
  const Z = () => typeof o.unit === 'number' && o.unit > 0 ? FIT.s / o.unit : 1;

  /* --- shape → mask --- */
  async function rasterize(svg) {
    let markup = svg.trim();
    if (!markup.startsWith('<')) markup = `<svg xmlns="${SVGNS}"><path d="${markup.replace(/"/g, '')}"/></svg>`;
    let root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    if (root.nodeName !== 'svg' || root.querySelector('parsererror'))   // not strict XML → try the lenient HTML parser
      root = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
    if (!root) throw new Error('Could not read that SVG');
    const holder = document.createElementNS(SVGNS, 'svg'), g = document.createElementNS(SVGNS, 'g');
    holder.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:10px;height:10px;visibility:hidden');
    for (const ch of [...root.childNodes]) g.appendChild(document.importNode(ch, true));
    // outline = elements marked data-fur-shape (if any); everything else only paints colour (stains, masks…)
    const outline = g.cloneNode(true);
    if (outline.querySelector('[data-fur-shape]'))
      outline.querySelectorAll('path,ellipse,circle,rect,polygon,polyline,line,text,use,image')
        .forEach(el => { if (!el.closest('[data-fur-shape]') && !el.closest('defs')) el.remove(); });
    holder.append(g, outline); document.body.appendChild(holder);
    // spines (data-fur-spine polylines): read in the shape's own units, then left out of both pictures
    const spines = [...g.querySelectorAll('[data-fur-spine]')].map(el => {
      const m = g.getCTM().inverse().multiply(el.getCTM()), n = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number), pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) { const q = new DOMPoint(n[i], n[i + 1]).matrixTransform(m); pts.push([q.x, q.y]); }
      return pts;
    }).filter(p => p.length >= 2);
    for (const r of [g, outline]) r.querySelectorAll('[data-fur-spine]').forEach(el => el.remove());
    // light (data-fur-light: a grey picture of how much each spot is darkened, 0 none … white all, times shading): shades the fur
    // instead of its own outline, so parts made from one light look like one animal. Only light pictures, then left out of the others
    let lightSrc = null;
    if (g.querySelector('[data-fur-light]')) {
      const L = g.cloneNode(true);
      L.querySelectorAll('path,ellipse,circle,rect,polygon,polyline,line,text,use,image').forEach(el => { if (!el.closest('[data-fur-light]') && !el.closest('defs')) el.remove(); });
      lightSrc = L.innerHTML;
      for (const r of [g, outline]) r.querySelectorAll('[data-fur-light]').forEach(el => el.remove());
    }
    const bb = outline.getBBox(), maskSrc = outline.innerHTML, colorSrc = g.innerHTML;
    holder.remove();
    if (!bb.width || !bb.height) throw new Error('The shape is empty');
    const M = o.margin, s = Math.min((W - 2 * M) / bb.width, (H - 2 * M) / bb.height);
    const tx = (W - bb.width * s) / 2 - bb.x * s, ty = (H - bb.height * s) / 2 - bb.y * s;
    if (spines.flat().length > MAXP) throw new Error(`Too many spine points (${MAXP} at most)`);
    FIT = { tx, ty, s }; SPINES_SVG = spines; SPINES = spines.map(p => p.map(([x, y]) => [tx + x * s, ty + y * s]));
    const raster = async (inner, force) => {
      const str = `<svg xmlns="${SVGNS}" width="${GN}" height="${GN}" viewBox="0 0 ${W} ${H}">` +
        (force ? '<style>*{fill:#000!important;fill-opacity:1!important;opacity:1!important}</style>' : '') +
        `<g transform="translate(${tx} ${ty}) scale(${s})">${inner}</g></svg>`;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = GN;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, GN, GN);
      return x.getImageData(0, 0, GN, GN).data;
    };
    const mpx = await raster(maskSrc, true), m = new Uint8Array(NC);
    for (let i = 0; i < NC; i++) m[i] = mpx[i * 4 + 3] > 127 ? 1 : 0;
    SVG_PX = await raster(colorSrc, false);                         // the SVG's own colours
    LIGHT_PX = lightSrc ? await raster(lightSrc, false) : null;     // the light, if given
    return m;
  }

  /* --- signed distance, outward normals, centre --- */
  function prepField() {
    const din = new Float32Array(NC), dout = new Float32Array(NC); NEAR = new Int32Array(NC);
    let sx = 0, sy = 0, cnt = 0;
    for (let i = 0; i < NC; i++) {
      const a = IN[i]; din[i] = a ? 1e9 : 0; dout[i] = a ? 0 : 1e9; NEAR[i] = a ? i : -1;
      if (a) { sx += i % GN; sy += i / GN | 0; cnt++; }
    }
    chamfer(din, null, GN); chamfer(dout, NEAR, GN);
    SDF = new Float32Array(NC); DMAX = 1;
    for (let i = 0; i < NC; i++) { SDF[i] = (IN[i] ? din[i] - 0.5 : -(dout[i] - 0.5)) * GS; if (SDF[i] > DMAX) DMAX = SDF[i]; }
    CEN = cnt ? { x: (sx / cnt + 0.5) * GS, y: (sy / cnt + 0.5) * GS } : { x: W / 2, y: H / 2 };
    prepPieces();
    const N4 = new Float32Array(NC * 4);
    for (let y = 0; y < GN; y++) for (let x = 0; x < GN; x++) {
      const i = y * GN + x;
      N4[i * 4] = SDF[y * GN + Math.max(0, x - 1)] - SDF[y * GN + Math.min(GN - 1, x + 1)];
      N4[i * 4 + 1] = SDF[Math.max(0, y - 1) * GN + x] - SDF[Math.min(GN - 1, y + 1) * GN + x];
      N4[i * 4 + 3] = 1;
    }
    boxBlur(N4, GN, GN, 2); boxBlur(N4, GN, GN, 2);
    NX = new Float32Array(NC); NY = new Float32Array(NC);
    for (let i = 0; i < NC; i++) { const l = Math.hypot(N4[i * 4], N4[i * 4 + 1]) || 1; NX[i] = N4[i * 4] / l; NY[i] = N4[i * 4 + 1] / l; }
  }

  /* --- colours: inner → outer by depth, pseudo-3D shading --- */
  // colour source: 'svg' = the SVG's own fills (stains, gradients), 'flat' = inner → outer colours,
  // 'auto' = svg unless the artwork is plain black
  function svgHasColour() {
    let coloured = 0, inside = 0;
    for (let i = 0; i < NC; i++) if (IN[i]) { inside++; if (SVG_PX[i * 4 + 3] > 127 && SVG_PX[i * 4] + SVG_PX[i * 4 + 1] + SVG_PX[i * 4 + 2] > 60) coloured++; }
    return coloured > inside * 0.2;
  }
  function prepColors() {
    const ci = hex(o.colorInner), co = hex(o.colorOuter);
    const useSvg = o.colorSource === 'svg' || (o.colorSource === 'auto' && svgHasColour());
    let S4 = null, S4o = null;
    if (useSvg) {                                       // premultiplied SVG colour, outside cells borrow the nearest inside cell
      S4 = new Float32Array(NC * 4);
      for (let i = 0; i < NC; i++) {
        const s = NEAR[i] >= 0 ? NEAR[i] : i, a = SVG_PX[s * 4 + 3] / 255;
        S4[i * 4] = SVG_PX[s * 4] * a; S4[i * 4 + 1] = SVG_PX[s * 4 + 1] * a; S4[i * 4 + 2] = SVG_PX[s * 4 + 2] * a; S4[i * 4 + 3] = a;
      }
      if (o.invert) {                                   // inverted: outside, each cell's own colour (the hairs growing there)
        S4o = new Float32Array(NC * 4);
        for (let i = 0; i < NC; i++) if (!IN[i]) { const a = SVG_PX[i * 4 + 3] / 255;
          S4o[i * 4] = SVG_PX[i * 4] * a; S4o[i * 4 + 1] = SVG_PX[i * 4 + 1] * a; S4o[i * 4 + 2] = SVG_PX[i * 4 + 2] * a; S4o[i * 4 + 3] = a; }
      }
      const r = Math.round(o.colorBlur * Z() / GS);
      if (r > 0) for (let k = 0; k < 3; k++) { boxBlur(S4, GN, GN, r); if (S4o) boxBlur(S4o, GN, GN, r); }   // soft stain edges
    }
    COL = new Float32Array(NC * 3); const C = new Float32Array(NC * 4);
    for (let i = 0; i < NC; i++) {
      const s = NEAR[i] >= 0 ? NEAR[i] : i, d = Math.max(0, SDF[s]);
      const u = clamp(1 - d / (DMAX * 0.55), 0, 1) ** 2;
      const t = clamp(1 - d / (DMAX * 0.7), 0, 1), nz = Math.sqrt(1 - t * t);
      const lit = (-0.45 * NX[s] - 0.55 * NY[s]) * t + 0.7 * nz;
      const k = 1 - o.shading * (LIGHT_PX && LIGHT_PX[s * 4 + 3] > 127 ? LIGHT_PX[s * 4] / 255 : clamp(0.75 - lit, 0, 1));   // (a light given: shaded by it)
      for (let q = 0; q < 3; q++) {
        const a = S4 ? S4[i * 4 + 3] : 0;
        const base = S4 && a > 0.05 ? S4[i * 4 + q] / a : ci[q] + (co[q] - ci[q]) * u;
        const c = base * k; COL[i * 3 + q] = c; C[i * 4 + q] = c;
      }
      if (S4o && !IN[i] && S4o[i * 4 + 3] > 0.05) for (let q = 0; q < 3; q++) COL[i * 3 + q] = S4o[i * 4 + q] / S4o[i * 4 + 3] * k;   // (hair only: the base keeps the shape's)
      C[i * 4 + 3] = 1;
    }
    boxBlur(C, GN, GN, 3); boxBlur(C, GN, GN, 3);
    BASE_RGB = C;
  }

  /* --- soft base: alpha = smooth step across the outline --- */
  function paintBase() {
    const b = baseCv.getContext('2d'), img = b.createImageData(GN, GN);
    const z = Z(), w = Math.max(o.blur * z, 0.01), k = o.keepShape === true ? 0 : typeof o.keepShape === 'number' ? o.keepShape * z : o.keepShape, lo = typeof k === 'number' ? Math.min((o.edgeInset - o.blur / 2) * z, k - w) : (o.edgeInset - o.blur / 2) * z;   // (keepShape: solid by then at the latest)
    for (let i = 0; i < NC; i++) {
      const t = clamp((SDF[i] - lo) / w, 0, 1), al = t * t * (3 - 2 * t);
      if (al <= 0) continue;
      img.data[i * 4] = BASE_RGB[i * 4]; img.data[i * 4 + 1] = BASE_RGB[i * 4 + 1]; img.data[i * 4 + 2] = BASE_RGB[i * 4 + 2];
      img.data[i * 4 + 3] = al * 255;
    }
    b.putImageData(img, 0, 0);
    sendBase();
  }

  /* --- pieces: a shape in separate parts (four legs, two ears) — each piece's hair follows only its own points --- */
  // PIECE: each cell's piece (outside cells: the nearest inside cell's), PIECES: their boxes; specks join the nearest real piece
  let PIECE = null, PIECES = [], PIECE_PTS = null;
  function prepPieces() {
    PIECE = new Int32Array(NC).fill(-1); PIECES = [];
    const stack = [];
    for (let s = 0; s < NC; s++) {
      if (!IN[s] || PIECE[s] >= 0) continue;
      const id = PIECES.length, P = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, sx: 0, sy: 0, n: 0 };
      PIECE[s] = id; stack.push(s);
      while (stack.length) {
        const i = stack.pop(), x = i % GN, y = i / GN | 0;
        P.x0 = Math.min(P.x0, x); P.x1 = Math.max(P.x1, x); P.y0 = Math.min(P.y0, y); P.y1 = Math.max(P.y1, y); P.sx += x; P.sy += y; P.n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy, j = Y * GN + X;
          if (X >= 0 && Y >= 0 && X < GN && Y < GN && IN[j] && PIECE[j] < 0) { PIECE[j] = id; stack.push(j); }
        }
      }
      PIECES.push(P);
    }
    const big = PIECES.map((P, k) => k).filter(k => PIECES[k].n >= 40), to = PIECES.map((P, k) => {
      if (P.n >= 40 || !big.length) return k;
      let b = big[0], bd = Infinity;
      for (const q of big) { const Q = PIECES[q], d = Math.hypot(Q.sx / Q.n - P.sx / P.n, Q.sy / Q.n - P.sy / P.n); if (d < bd) { bd = d; b = q; } }
      return b;
    });
    for (let i = 0; i < NC; i++) { const s = IN[i] ? i : NEAR[i]; PIECE[i] = s >= 0 ? to[PIECE[s]] : -1; }
    for (const P of PIECES) Object.assign(P, { x0: P.x0 * GS, y0: P.y0 * GS, x1: (P.x1 + 1) * GS, y1: (P.y1 + 1) * GS, cx: (P.sx / P.n + 0.5) * GS, cy: (P.sy / P.n + 0.5) * GS });
    PIECE_PTS = null;
  }
  // the points each piece's hair follows: the ones placed by it (nearest to it); a piece with none borrows the nearest
  // piece's, moved to the same place on its own box (one point above a leg → above every leg); none at all → its centre
  function piecePoints() {
    const n = PIECES.length, own = PIECES.map(() => []), all = o.points;
    if (n <= 1) return [all.some(p => p.type !== 'swirl') ? all : [{ x: CEN.x / W, y: CEN.y / H, type: 'source', strength: 1 }, ...all]];
    for (const p of all) { const i = gi(p.x * W, p.y * H), k = i >= 0 ? PIECE[i] : -1; if (k >= 0) own[k].push(p); else own[0].push(p); }
    return PIECES.map((P, k) => {
      let pts = own[k];
      if (!pts.length) {
        let b = -1, bd = Infinity;
        own.forEach((q, j) => { if (!q.length) return; const Q = PIECES[j], d = Math.hypot(Q.cx - P.cx, Q.cy - P.cy); if (d < bd) { bd = d; b = j; } });
        if (b >= 0) { const Q = PIECES[b], sx = (P.x1 - P.x0) / (Q.x1 - Q.x0 || 1), sy = (P.y1 - P.y0) / (Q.y1 - Q.y0 || 1);
          pts = own[b].map(p => ({ ...p, x: (P.x0 + (p.x * W - Q.x0) * sx) / W, y: (P.y0 + (p.y * H - Q.y0) * sy) / H })); }
      }
      return pts.some(p => p.type !== 'swirl') ? pts : [{ x: P.cx / W, y: P.cy / H, type: 'source', strength: 1 }, ...pts];
    });
  }

  /* --- hair direction --- */
  const edgeOf = d => { const z = Z(), t = clamp(1 - (d - o.hairInset * z) / (o.edgeBand * z), 0, 1); return t * t * (3 - 2 * t); };
  function flow(x, y, out) {   // out: an inverted edge hair (see makeLines)
    if (!PIECE_PTS) PIECE_PTS = piecePoints();
    const i0 = gi(x, y), pts = PIECE_PTS[PIECE_PTS.length > 1 && i0 >= 0 && PIECE[i0] >= 0 ? PIECE[i0] : 0];
    const z = Z(), z2 = z * z, band = (o.hairInset + o.edgeBand) * z;
    let vx = 0, vy = 0;
    for (const p of pts) {                                       // nearest point dominates (1/d²)
      const dx = x - p.x * W, dy = y - p.y * H, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
      if (p.type === 'swirl') {                                  // swirls are local (fade out ~160 units away)
        const w = 3 * (p.strength ?? 1) / (d2 + 1600 * z2) * Math.exp(-d2 / (25600 * z2));
        vx += -dy / d * w; vy += dx / d * w;
      } else { const w = (p.strength ?? 1) / (d2 + 1600 * z2); vx += dx / d * w; vy += dy / d * w; }
    }
    const l = Math.hypot(vx, vy) || 1; vx /= l; vy /= l;
    const i = gi(x, y);
    if (i >= 0 && !o.invert) { const e = clamp(1 - SDF[i] / band, 0, 1); vx += o.edgeOut * e * NX[i]; vy += o.edgeOut * e * NY[i]; }
    else if (i >= 0 && out) { const e = clamp(1 + SDF[i] / band, 0, 1); vx -= o.edgeOut * e * NX[i]; vy -= o.edgeOut * e * NY[i]; }   // (turned in)
    vy += o.gravity;
    const wx = x / z, wy = y / z;
    return Math.atan2(vy, vx) + o.waviness * Math.sin(wx * 0.035 + wy * 0.02) * Math.cos(wy * 0.03 - wx * 0.012);
  }

  /* --- spines: each spot tied to the nearest one --- */
  function prepSpines() {
    SP = []; FLAG = []; SPID = [];
    SPINES.forEach((p, n) => p.forEach((q, i) => { SP.push(q); SPID.push(n); FLAG.push((i === 0 ? 1 : 0) | (i === p.length - 1 ? 2 : 0)); }));
    RT = SP.map((q, k) => { const a = FLAG[k] & 1 ? k : k - 1, b = FLAG[k] & 2 ? k : k + 1, dx = SP[b][0] - SP[a][0], dy = SP[b][1] - SP[a][1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l]; });
  }
  // a spot in the frame of segment k at t: [segment (index of its first point in SP), t (past 0 / 1 beyond a spine's ends), offset along, offset across, direction]
  function segSpot(k, t, x, y) {
    const tc = clamp(t, 0, 1), tx = RT[k][0] + (RT[k + 1][0] - RT[k][0]) * tc, ty = RT[k][1] + (RT[k + 1][1] - RT[k][1]) * tc, l = Math.hypot(tx, ty) || 1;
    const T = [tx / l, ty / l], rx = x - (SP[k][0] + (SP[k + 1][0] - SP[k][0]) * t), ry = y - (SP[k][1] + (SP[k + 1][1] - SP[k][1]) * t);
    return [k, t, rx * T[0] + ry * T[1], ry * T[0] - rx * T[1], Math.atan2(T[1], T[0])];
  }
  // the nearest segment, and the nearest other one of the same spine: a spot near both (a knee) goes with both, more of the
  // nearer, so the fur never tears where one bone hands over to the next. → [first spot (4), second spot (4), share of the second, their directions]
  const BLEND = 24;
  function spineAt(x, y) {
    const near = [];
    for (let j = 0; j < SP.length - 1; j++) {
      if (FLAG[j] & 2) continue;                                  // (last point of a spine: no segment starts here)
      const A = SP[j], B = SP[j + 1], dx = B[0] - A[0], dy = B[1] - A[1], u = ((x - A[0]) * dx + (y - A[1]) * dy) / (dx * dx + dy * dy || 1e-9);
      // past a spine's end a spot goes on along its last direction (uc), but how near it is counts from the end itself,
      // so the line running on never takes spots from another part lying further along it
      const uc = clamp(u, FLAG[j] & 1 ? -Infinity : 0, FLAG[j + 1] & 2 ? Infinity : 1), ud = clamp(u, 0, 1);
      near.push([j, uc, Math.hypot(x - A[0] - dx * ud, y - A[1] - dy * ud)]);
    }
    let a = near[0]; for (const s of near) if (s[2] < a[2]) a = s;
    // (only the segment before or after it on its spine: one sharing a joint with it)
    let b = a; for (const s of near) if (Math.abs(s[0] - a[0]) === 1 && SPID[s[0]] === SPID[a[0]] && (b === a || s[2] < b[2])) b = s;
    const w = b === a ? 0 : 0.5 * clamp(1 - (b[2] - a[2]) / BLEND, 0, 1), A = segSpot(a[0], a[1], x, y), B = segSpot(b[0], b[1], x, y);
    return [A[0], A[1], A[2], A[3], B[0], B[1], B[2], B[3], w, A[4], B[4]];
  }

  /* --- lines --- */
  function makeLines() {
    rand = seeded(o.seed); PIECE_PTS = null;   // (points may have changed)
    const q0 = Q(), z = Z(), q = { ...q0, hw: q0.hw * z }, S = 2.0, out = [], inv = !!o.invert;
    const hairInset = o.hairInset * z, edgeBand = o.edgeBand * z, hairMin = o.hairMin * z, hairMax = o.hairMax * z;
    const passes = [
      { cover: 2.1, len: 1.0, op: [0.6, 0.35], jit: 1.0, inner: o.innerDensity }, // main layer
      { cover: 1.4, len: 0.6, op: [0.65, 0.3], jit: 1.85, inner: 0 },             // fine detail at the edge
    ];
    for (const P of passes) {
      const list = [];
      for (let oy = 0; oy < H; oy += S) for (let ox = 0; ox < W; ox += S) {
        let count = -1, edge = 0;
        for (let k = 0; k !== count; k++) {
          const x = ox + (rand() - 0.5) * S, y = oy + (rand() - 0.5) * S, i = gi(x, y);
          if (i < 0) break;
          // inverted: the edge hairs root outside the outline (hairInset to hairInset + edgeBand out, only where the SVG paints:
          // the ear round an inner ear) and lie in over the shape, which keeps only its inner hairs. d: how far from the outline
          const ex = inv && SDF[i] < 0, d = ex ? -SDF[i] : SDF[i];
          if (ex ? d < hairInset || d > hairInset + edgeBand || SVG_PX[i * 4 + 3] < 128 : !inv && d < hairInset) break;   // roots inside the hair outline
          const dn = clamp(1 - d / DMAX, 0, 1), e = inv && !ex ? 0 : edgeOf(d);
          const len0 = (hairMin + (hairMax - hairMin) * dn ** 1.6) * P.len * (0.75 + 0.5 * rand());
          let len = len0 * (1 + o.edgeLength * e * e);                   // longer toward the edge
          const a = flow(x, y, ex) + (rand() - 0.5) * 0.22;
          const ai = gi(x + Math.cos(a) * 12 * z, y + Math.sin(a) * 12 * z), rim = !(inv && !ex) && (ai < 0 || (ex ? -SDF[ai] : SDF[ai]) < hairInset);
          if (rim) len *= 1.2 + 0.6 * rand();                            // wispy outline
          if (inv && !ex) { const ti = gi(x + Math.cos(a) * len, y + Math.sin(a) * len), dt = ti < 0 ? -len : SDF[ti];
            if (dt < 0) len *= clamp(d / (d - dt), 0.15, 1); }           // (inverted, inside: ends at the outline)
          const c0 = [COL[i * 3], COL[i * 3 + 1], COL[i * 3 + 2]];
          if (count < 0) {
            edge = e;
            const lum = (0.3 * c0[0] + 0.59 * c0[1] + 0.11 * c0[2]) / 255;
            const dens = ex ? o.edgeDensity * edge : P.inner + (o.edgeDensity - P.inner) * edge;
            const m = dens * P.cover * q.cover * (1 + 0.6 * (1 - lum) ** 2) * S * S / (len0 * 0.92 * q.hw * 1.2);
            count = Math.floor(m) + (rand() < m % 1 ? 1 : 0);
            if (!count) break;
          }
          const mi = gi(x + Math.cos(a) * len * 0.4, y + Math.sin(a) * len * 0.4);
          const c1 = mi >= 0 && (ex ? !IN[mi] && SVG_PX[mi * 4 + 3] > 127 : IN[mi]) ? [COL[mi * 3], COL[mi * 3 + 1], COL[mi * 3 + 2]] : c0;
          const soft = rand() < edge + (1 - edge) * o.crisp ? 0 : 0.85;
          const j = (1 + o.rim * edge + o.variation * P.jit * (soft ? 0.6 : 1 + 0.4 * (1 - edge)) * (1.3 * rand() - 0.3)) / 255;
          list.push({ x, y, a, len, op: P.op[0] + P.op[1] * rand(), hw: (0.75 + 0.35 * rand()) * q.hw * (rim ? 0.75 : 1),
            bend: angDiff(flow(x + Math.cos(a) * len, y + Math.sin(a) * len, ex), a) + (rand() - 0.5) * (rim ? 0.7 : 0.15),
            soft, fade: 0.3 + 0.45 * edge, c: [0, 1, 2].map(n => clamp((c0[n] + c1[n]) / 2 * j, 0, 1)), z: ex ? 1e4 + d : SDF[i] });   // (inverted edge hairs on top)
        }
      }
      list.sort((a, b) => a.z - b.z);                                    // edge first, inner on top
      for (const l of list) out.push(l);
    }
    return out;
  }

  /* --- GL --- */
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const link = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
  const prog = link(VS, FS), progB = link(VSB, FSB);
  const U = (p, ...n) => Object.fromEntries(n.map(k => [k, gl.getUniformLocation(p, 'u_' + k)]));
  const uH = U(prog, 'px', 'bent', 'k', 'view', 'sp'), uB = U(progB, 'k', 'view', 'sp', 'tex');
  // the bent base: grid (x, y, then its two spine spots and the second's share: 11 floats a point), and the base picture as a texture
  const vaoB = gl.createVertexArray(), gridBuf = gl.createBuffer(), idxBuf = gl.createBuffer(), tex = gl.createTexture(); let nIdx = 0;
  gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
  [[0, 2, 0], [1, 4, 8], [2, 4, 24], [3, 1, 40]].forEach(([l, n, ofs]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 44, ofs); });
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const vaoH = gl.createVertexArray();
  gl.bindVertexArray(vaoH);
  const tplBuf = gl.createBuffer(); let VERTS = 0;
  const setSeg = n => { const tv = []; for (let i = 0; i <= n; i++) tv.push(i / n, -1, i / n, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, tplBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tv), gl.STATIC_DRAW); VERTS = (n + 1) * 2; };
  setSeg(Q().seg);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const statBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, statBuf);
  [[1, 4, 0], [2, 4, 16], [3, 4, 32]].forEach(([loc, size, ofs]) => {
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 48, ofs); gl.vertexAttribDivisor(loc, 1);
  });
  const offBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(4, 1);
  const spBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, spBuf);   // each hair's spine spots (11 floats, see spineAt)
  [[5, 4, 0], [6, 4, 16], [7, 3, 32]].forEach(([l, n, ofs]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 44, ofs); gl.vertexAttribDivisor(l, 1); });
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // the base's grid for the shape's spines (built with the shape), and its picture (sent again each time it is painted)
  function prepGrid() {
    if (!SP.length) { nIdx = 0; return; }
    const G = 64, v = new Float32Array((G + 1) ** 2 * 11), seg = new Int32Array((G + 1) ** 2), idx = new Uint16Array(G * G * 6);
    for (let y = 0; y <= G; y++) for (let x = 0; x <= G; x++) {
      const px = x / G * W, py = y / G * H, s = spineAt(px, py), i = y * (G + 1) + x;
      v.set([px, py, ...s.slice(0, 9)], i * 11); seg[i] = s[0];
    }
    // a triangle whose corners go with segments that share no joint (two parts, or across the inside of a Z-shaped leg) would
    // stretch over the gap between them as they bend: left out (only empty space between parts lies there)
    const fits = (...t) => { const s = t.map(i => seg[i]); return Math.max(...s) - Math.min(...s) <= 1 && s.every(k => SPID[k] === SPID[s[0]]); };
    let n = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const a = y * (G + 1) + x, c = a + G + 1;
      if (fits(a, a + 1, c)) { idx.set([a, a + 1, c], n); n += 3; }
      if (fits(a + 1, c + 1, c)) { idx.set([a + 1, c + 1, c], n); n += 3; }
    }
    gl.bindVertexArray(vaoB);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx.subarray(0, n), gl.STATIC_DRAW);
    gl.bindVertexArray(vaoH); nIdx = n;
  }
  function sendBase() {
    if (!SP.length) return;
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, baseCv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (BENT) draw();
  }

  let N = 0, X, Y, A, OFF, TGT, ACT, active = [], cells, buildMs = 0, fps = 0;
  const CELL = 64, GWc = Math.ceil(W / CELL);
  function build() {
    if (!IN) return;
    const t0 = performance.now(), lines = makeLines();
    N = lines.length;
    const stat = new Float32Array(N * 12);
    X = new Float32Array(N); Y = new Float32Array(N); A = new Float32Array(N);
    OFF = new Float32Array(N); TGT = new Float32Array(N); ACT = new Uint8Array(N); active = [];
    cells = Array.from({ length: GWc * Math.ceil(H / CELL) }, () => []);
    lines.forEach((s, i) => {
      stat.set([s.x, s.y, s.a, s.len, s.hw, s.bend, s.soft, s.fade, s.c[0], s.c[1], s.c[2], s.op], i * 12);
      X[i] = s.x; Y[i] = s.y; A[i] = s.a;
      cells[(s.y / CELL | 0) * GWc + (s.x / CELL | 0)]?.push(i);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, statBuf); gl.bufferData(gl.ARRAY_BUFFER, stat, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, offBuf); gl.bufferData(gl.ARRAY_BUFFER, OFF, gl.DYNAMIC_DRAW);
    const spd = new Float32Array(N * 11);
    if (SP.length) lines.forEach((s, i) => spd.set(spineAt(s.x, s.y), i * 11));
    gl.bindBuffer(gl.ARRAY_BUFFER, spBuf); gl.bufferData(gl.ARRAY_BUFFER, spd, gl.STATIC_DRAW);
    buildMs = Math.round(performance.now() - t0);
    draw();
  }
  function draw() {
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const view = BENT ? BENT.view : [0, 0, W, H], k = 1 / FIT.s;
    if (BENT && nIdx) {                                          // bent: the soft base is drawn here (its own canvas is hidden)
      gl.useProgram(progB); gl.bindVertexArray(vaoB);
      gl.uniform1f(uB.k, k); gl.uniform4fv(uB.view, view); gl.uniform4fv(uB.sp, BENT.sp); gl.uniform1i(uB.tex, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
    }
    gl.useProgram(prog); gl.bindVertexArray(vaoH);
    if (!N) return;
    gl.uniform1f(uH.px, cv.width / view[2]); gl.uniform4fv(uH.view, view); gl.uniform1f(uH.bent, BENT ? 1 : 0); gl.uniform1f(uH.k, k);
    if (BENT) gl.uniform4fv(uH.sp, BENT.sp);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, VERTS, N);
  }
  function resize() {
    const r = container.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, Q().dpr);
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    draw();
  }
  const ro = new ResizeObserver(resize); ro.observe(container);

  /* --- petting --- */
  let last = null, running = false, lastT = 0;
  const toStage = (cx, cy) => { const r = container.getBoundingClientRect(); return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height }; };
  function pet(e) {
    if (!o.pet || !N || BENT) return;                              // (bent: the hairs are not where the pointer finds them)
    const s = toStage(e.clientX, e.clientY), p = { x: s.x * W, y: s.y * H }, R = o.petRadius;
    if (last) {
      const dx = p.x - last.x, dy = p.y - last.y, speed = Math.hypot(dx, dy);
      if (speed > 0.6) {
        const dir = Math.atan2(dy, dx), push = Math.min(1, speed / 12);
        const c0 = Math.max(0, (p.x - R) / CELL | 0), c1 = Math.min(GWc - 1, (p.x + R) / CELL | 0);
        const r0 = Math.max(0, (p.y - R) / CELL | 0), r1 = Math.min(cells.length / GWc - 1, (p.y + R) / CELL | 0);
        for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) for (const i of cells[cy * GWc + cx]) {
          const d = Math.hypot(X[i] - p.x, Y[i] - p.y);
          if (d > R) continue;
          const w = (1 - d / R) ** 2 * push;
          TGT[i] += (clamp(angDiff(dir, A[i]), -1.2, 1.2) - TGT[i]) * w * 0.6; // with the grain: flat · against: ruffle
          if (!ACT[i]) { ACT[i] = 1; active.push(i); }
        }
        if (!running) { running = true; requestAnimationFrame(tick); }
      }
    }
    last = p;
  }
  function tick(t) {
    if (lastT) fps = Math.round(0.9 * (fps || 60) + 0.1 * Math.min(120, 1000 / (t - lastT)));
    lastT = t;
    let k = 0;
    for (const i of active) {
      TGT[i] *= 0.975; OFF[i] += (TGT[i] - OFF[i]) * 0.2;            // soft follow, slow relax
      if (Math.abs(OFF[i]) < 0.002 && Math.abs(TGT[i]) < 0.002) { OFF[i] = TGT[i] = 0; ACT[i] = 0; } else active[k++] = i;
    }
    active.length = k;
    gl.bindBuffer(gl.ARRAY_BUFFER, offBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, OFF);
    draw();
    if (k) requestAnimationFrame(tick); else { running = false; lastT = 0; }
  }
  const onMove = e => pet(e), onDown = e => { last = null; pet(e); }, onLeave = () => { last = null; };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerleave', onLeave);

  /* --- public API --- */
  return {
    async setShape(svg) {
      lastShape = svg;
      IN = await rasterize(svg);
      BENT = null; baseCv.style.visibility = '';
      prepSpines(); prepGrid(); prepField(); prepColors(); paintBase(); build();
    },
    // the shape's spines as they are now: one list of points per data-fur-spine line (same order and counts), each point
    // [x, y] or [x, y, width scale], in the units of view {x, y, width, height} (the rectangle the canvas shows; keep it the
    // canvas's shape). view left out: the stage in the shape's own units. null: back to the shape as drawn. Only redraws
    bend(spines, view) {
      if (!spines || !SPINES.length) { BENT = null; baseCv.style.visibility = ''; draw(); return; }
      if (spines.length !== SPINES.length || spines.some((p, j) => p.length !== SPINES[j].length)) throw new Error('bend needs the shape\'s spines, point for point');
      const sp = BENT?.sp || new Float32Array(MAXP * 4); let n = 0;
      spines.forEach(p => p.forEach((q, i) => sp.set([q[0], q[1], q[2] ?? 1, (i === 0 ? 1 : 0) | (i === p.length - 1 ? 2 : 0)], 4 * n++)));
      const v = view || { x: -FIT.tx / FIT.s, y: -FIT.ty / FIT.s, width: W / FIT.s, height: H / FIT.s };
      BENT = { sp, view: [v.x, v.y, v.width, v.height] };
      baseCv.style.visibility = 'hidden'; draw();
    },
    spines: () => JSON.parse(JSON.stringify(SPINES_SVG)),   // the shape's spines as drawn (its own units)
    set(patch) {
      const keys = Object.keys(patch).filter(k => JSON.stringify(o[k]) !== JSON.stringify(patch[k]));
      if (!keys.length) return;
      Object.assign(o, JSON.parse(JSON.stringify(patch)));
      if (keys.includes('margin') && lastShape) return this.setShape(lastShape);
      if (!IN) return;
      if (keys.includes('quality')) { setSeg(Q().seg); resize(); }
      const color = keys.some(k => COLOR_KEYS.has(k));
      if (color) prepColors();
      if (color || keys.some(k => BASE_KEYS.has(k))) paintBase();
      if (keys.some(k => !BASE_KEYS.has(k) && !LIVE_KEYS.has(k))) build();
    },
    get: () => JSON.parse(JSON.stringify(o)),
    rebuild: build,
    toStage,                                   // client px → 0–1 stage coords (for placing points)
    stats: () => ({ lines: N, buildMs, fps }),
    fit: () => ({ ...FIT }),                   // how the shape sits in the stage (stage = shape × s + t)
    destroy() {
      ro.disconnect();
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerleave', onLeave);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      baseCv.remove(); cv.remove();
    },
  };
}
