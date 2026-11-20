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
const COLOR_KEYS = new Set(['unit', 'colorInner', 'colorOuter', 'shading', 'colorSource', 'colorBlur', 'invert', 'variation', 'rim', 'crisp', 'hairInset', 'edgeBand']);   // (the last five: the base takes the hairs' average brightness)
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
// (u_sp: x, y, width scale, 1 = first point of its spine | 2 = last), in view units: position, and how far the spine's direction
// there has turned since drawn (cos, sin; u_rs: the spines as drawn, stage units, same flags)
// Each spot goes with up to four segments (a_s0…a_s3), shared out by a_w: the shares change smoothly everywhere, so the fur
// never tears where one segment or part hands over to the next
// a joint's crease: folded from FOLD[0]° (nothing yet) to FOLD[1]° (cut all the way), and how dark its shadow is at most
const FOLD = [75, 130, 0.25];
// how much of a bit of fur a leg (any part not the hub) must hold for it to be in that leg's layer (see build, bend's z)
const LEG_LAYER = 0.3;
const SPINE_GLSL = `
// the spine as a smooth curve through its points (Catmull-Rom; at a spine's ends its end point mirrored): point and slope at t of segment i
void cr(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t, out vec2 P, out vec2 D, out vec2 A){
  vec2 a = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3, b = -p0 + 3.0 * p1 - 3.0 * p2 + p3, c = p2 - p0;
  P = 0.5 * (2.0 * p1 + c * t + a * t * t + b * t * t * t); D = 0.5 * (c + 2.0 * a * t + 3.0 * b * t * t); A = a + 3.0 * b * t;
}
void crSp(int i, float t, out vec2 P, out vec2 D, out vec2 A){
  vec2 p1 = u_sp[i].xy, p2 = u_sp[i + 1].xy;
  vec2 p0 = (int(u_sp[i].w + 0.5) & 1) != 0 ? 2.0 * p1 - p2 : u_sp[max(i - 1, 0)].xy;
  vec2 p3 = (int(u_sp[i + 1].w + 0.5) & 2) != 0 ? 2.0 * p2 - p1 : u_sp[min(i + 2, ${MAXP - 1})].xy;
  cr(p0, p1, p2, p3, t, P, D, A);
}
void crRs(int i, float t, out vec2 P, out vec2 D, out vec2 A){
  vec2 p1 = u_rs[i].xy, p2 = u_rs[i + 1].xy;
  vec2 p0 = (int(u_rs[i].w + 0.5) & 1) != 0 ? 2.0 * p1 - p2 : u_rs[max(i - 1, 0)].xy;
  vec2 p3 = (int(u_rs[i + 1].w + 0.5) & 2) != 0 ? 2.0 * p2 - p1 : u_rs[min(i + 2, ${MAXP - 1})].xy;
  cr(p0, p1, p2, p3, t, P, D, A);
}
vec4 spineAt(vec4 s){
  int i = int(s.x + 0.5); float t = s.y, tc = clamp(t, 0.0, 1.0);
  vec2 P, D, A, P0, D0, A0; crSp(i, tc, P, D, A); crRs(i, tc, P0, D0, A0);
  vec2 T = normalize(D), N = vec2(-T.y, T.x), T0 = normalize(D0);
  P += T * (t - tc) * length(u_sp[i + 1].xy - u_sp[i].xy);   // (past a spine's end: on along its end direction)
  float w = mix(u_sp[i].z, u_sp[i + 1].z, tc);
  return vec4(P + (T * s.z + N * s.w * w) * u_k, T.x * T0.x + T.y * T0.y, T.y * T0.x - T.x * T0.y);
}
void take(vec4 s, float w, inout vec2 r, inout vec2 d){ if (w > 0.0) { vec4 f = spineAt(s); r += w * f.xy; d += w * f.zw; } }
// A joint folded tight (a knee, a hock, an elbow): its two bones overlap on the fold's inner side, and there the fur is cut along the
// crease: fur lying past one bone's end goes with the next bone only (no blend of the two, which smeared them into one), the bone
// above lies over the one below (the hairs' order), and the one below is in the fold's shadow near the crease. On the outer side
// and at gentle bends the fur still blends across the joint, so it stretches round the knee and never tears. (The hub, a body's
// line, never creases.) foldAt: how folded the spine is at point J now (0 up to ${FOLD[0]}°, 1 from ${FOLD[1]}°), sg which way
float foldAt(int J, out float sg){
  sg = 1.0;
  if ((int(u_sp[J].w + 0.5) & 3) != 0 || (int(u_rs[J].w + 0.5) & 4) != 0) return 0.0;
  vec2 a = u_sp[J].xy - u_sp[J - 1].xy, b = u_sp[J + 1].xy - u_sp[J].xy; float la = length(a), lb = length(b);
  if (la < 1e-5 || lb < 1e-5) return 0.0;
  a /= la; b /= lb; sg = a.x * b.y - a.y * b.x >= 0.0 ? 1.0 : -1.0;
  return smoothstep(${(FOLD[0] * Math.PI / 180).toFixed(4)}, ${(FOLD[1] * Math.PI / 180).toFixed(4)}, acos(clamp(dot(a, b), -1.0, 1.0)));
}
// one tie's share kept (1, or less where it lies past its bone across a crease), and the fold's shadow on it (its bone below a crease)
float creaseOf(vec4 s, inout float shade, float w){
  int i = int(s.x + 0.5); float t = s.y, e = s.z, sg, keep = 1.0;
  if (w <= 0.0) return 1.0;
  int J = t >= 0.999 && e > 0.0 ? i + 1 : t <= 0.001 && e < 0.0 ? i : -1;   // (past its end, or before its start)
  if (J >= 0) { float f = foldAt(J, sg); keep = 1.0 - f * smoothstep(-2.0, 2.0, s.w * sg); }
  // the fold's shadow, soft, on the inner side and fading across the bone: on the bone below from the crease down (its bone starts at a
  // fold), and a narrower one on the bone above up to it (its bone ends at a fold), so the crease reads as the one tucked under the other
  float L = length(u_rs[i + 1].xy - u_rs[i].xy), f0 = foldAt(i, sg);
  if (f0 > 0.0) shade += w * f0 * smoothstep(-0.25 * L, 0.25 * L, s.w * sg) * (1.0 - smoothstep(0.0, 0.45 * L, t * L + e));
  float f1 = foldAt(i + 1, sg);
  if (f1 > 0.0) shade += 0.6 * w * f1 * smoothstep(-0.25 * L, 0.25 * L, s.w * sg) * (1.0 - smoothstep(0.0, 0.2 * L, (1.0 - t) * L - e));
  return keep;
}
// the four ties' shares after the creases (and the shadow there)
vec4 crease(vec4 s0, vec4 s1, vec4 s2, vec4 s3, vec4 w, out float shade){
  shade = 0.0;
  vec4 k = vec4(creaseOf(s0, shade, w.x), creaseOf(s1, shade, w.y), creaseOf(s2, shade, w.z), creaseOf(s3, shade, w.w)), v = w * k;
  float n = v.x + v.y + v.z + v.w;
  return n > 1e-4 ? v / n : w;
}`;
// the soft base when bent: a grid over the stage, each point tied to its spines, painted with the base picture
const VSB = `#version 300 es
layout(location=0) in vec2 a_pos;    // grid point (stage units)
layout(location=1) in vec4 a_s0;
layout(location=2) in vec4 a_s1;
layout(location=3) in vec4 a_s2;
layout(location=4) in vec4 a_s3;
layout(location=5) in vec4 a_w;
uniform float u_k, u_floor; uniform vec4 u_view, u_sp[${MAXP}], u_rs[${MAXP}]; uniform int u_layer;
out vec2 v_uv; out float v_y; out float v_own; out float v_shade;
${SPINE_GLSL}
float own(vec4 s, float w){ return w > 0.0 && int(u_rs[int(s.x + 0.5)].z + 0.5) == u_layer ? w : 0.0; }   // (u_rs .z: each point's spine)
void main(){
  vec2 q = vec2(0.0), d = vec2(0.0);
  float sh; vec4 cw = crease(a_s0, a_s1, a_s2, a_s3, a_w, sh); v_shade = sh;
  take(a_s0, cw.x, q, d); take(a_s1, cw.y, q, d); take(a_s2, cw.z, q, d); take(a_s3, cw.w, q, d);
  v_uv = a_pos / 780.0; v_y = q.y;
  v_own = u_layer < 0 ? 1.0 : own(a_s0, a_w.x) + own(a_s1, a_w.y) + own(a_s2, a_w.z) + own(a_s3, a_w.w);   // (one part's layer: how much of it is that part's)
  gl_Position = vec4((q.x - u_view.x) / u_view.z * 2.0 - 1.0, 1.0 - (q.y - u_view.y) / u_view.w * 2.0, 0.0, 1.0);
}`;
const FSB = `#version 300 es
precision highp float;
in vec2 v_uv; in float v_y; in float v_own; in float v_shade; uniform sampler2D u_tex; uniform float u_floor, u_fsoft; uniform highp int u_layer; out vec4 o;
void main(){ o = texture(u_tex, v_uv) * (1.0 - smoothstep(u_floor - u_fsoft, u_floor, v_y));   // (gone by the floor, fading out above it: the hairs make the edge there)
  // one part's layer: only where it is that part, fading out where it joins the others, and only its solid inside (its own edge
  // hairs make its outline over what lies behind it)
  if (u_layer >= 0) o *= smoothstep(${LEG_LAYER * 0.6}, ${Math.min(1, LEG_LAYER * 2)}, v_own) * smoothstep(0.6, 0.95, o.a);   // (from where the hairs are this part's: LEG_LAYER)
  o.rgb *= 1.0 - ${FOLD[2]} * v_shade;   // (the fold's shadow)
  if (o.a < 0.004) discard; }`;
const VS = `#version 300 es
layout(location=0) in vec2 a_tv;     // t along line (0 root → 1 tip), side (-1 | 1)
layout(location=1) in vec4 a_root;   // x, y, angle, length
layout(location=2) in vec4 a_shape;  // half width, bend, softness, root fade length
layout(location=3) in vec4 a_col;    // rgb, opacity
layout(location=4) in float a_off;   // petting offset (radians)
layout(location=5) in vec4 a_s0;     // on its spines: segment, t along it, offsets along / across it (stage units)…
layout(location=6) in vec4 a_s1;
layout(location=7) in vec4 a_s2;
layout(location=8) in vec4 a_s3;
layout(location=9) in vec4 a_w;      // …and the share of each
uniform float u_px, u_bent, u_k, u_floor; uniform vec4 u_view, u_sp[${MAXP}], u_rs[${MAXP}];
out vec4 v_col; out float v_side; out float v_soft;
${SPINE_GLSL}
void main(){
  float t = a_tv.x, off = a_off, soft = a_shape.z, fold = 0.0;
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
  if (u_bent > 0.5) {                                         // bent: root and direction go with the spines
    vec2 d = vec2(0.0); r = vec2(0.0);
    vec4 cw = crease(a_s0, a_s1, a_s2, a_s3, a_w, fold);
    take(a_s0, cw.x, r, d); take(a_s1, cw.y, r, d); take(a_s2, cw.z, r, d); take(a_s3, cw.w, r, d);
    ang += atan(d.y, d.x);
  }
  float cs = cos(ang), sn = sin(ang);
  vec2 q = r + vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) * k;
  if (u_bent > 0.5 && u_floor < 1e8) {
    // the floor: every hair has its own, a little above the line (by its root, up to a third of its length), so the fur's lower edge is
    // ragged like fur, not ruled; a hair that would go through it bends aside, more toward its tip, so it curves down to lie along it
    float h = fract(sin(dot(a_root.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float fl = max(u_floor - h * 0.35 * len * k, min(r.y, u_floor));
    vec2 to = vec2(cs * len - sn * 0.5 * bend * len, sn * len + cs * 0.5 * bend * len) * k;   // (its tip, as it would be)
    float L = length(to), sd = to.x > 1e-4 * L ? 1.0 : to.x < -1e-4 * L ? -1.0 : (h < 0.5 ? -1.0 : 1.0);
    if (r.y + to.y > fl && L > 1e-5) {
      float b1 = asin(clamp((fl - r.y) / L, -1.0, 1.0)); b1 = sd > 0.0 ? b1 : 3.14159265 - b1;
      float th = mod(b1 - atan(to.y, to.x) + 3.14159265, 6.2831853) - 3.14159265;
      th *= 0.55 + 0.45 * t;
      vec2 d = q - r; float c2 = cos(th), s2 = sin(th);
      q = r + vec2(c2 * d.x - s2 * d.y, s2 * d.x + c2 * d.y);
    }
    if (q.y > fl) { float e = q.y - fl; q = vec2(q.x + sd * e * 0.85, fl - e * 0.06); }   // (what still reaches it lies flat on it)
  }
  gl_Position = vec4((q.x - u_view.x) / u_view.z * 2.0 - 1.0, 1.0 - (q.y - u_view.y) / u_view.w * 2.0, 0.0, 1.0);
  v_col = vec4(a_col.rgb * (1.0 - ${FOLD[2]} * fold), a); v_side = a_tv.y; v_soft = soft;   // (in a fold's shadow: darker)
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
  // the soft base is painted at twice the grid's size, its edge from the drawing's own smooth (anti-aliased) outline: from the grid's
  // inside/outside cells it showed stair steps once Shape blur was low
  const BN = GN * 2, BS = W / BN;
  baseCv.width = baseCv.height = BN;
  const gl = cv.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('fur.js needs WebGL2');

  let rand, lastShape = null;
  let COV = null, SDFB = null, SVG_PX = null, LIGHT_PX = null, FADE_PX = null, IN = null, SDF, NEAR, NX, NY, COL, BASE_RGB, DMAX = 1, CEN = { x: W / 2, y: H / 2 };
  // spines: as drawn (shape units, SPINES_SVG) and in stage units (SPINES; SP all their points, FLAG first/last, RT directions);
  // FIT: how the shape sits in the stage (stage = shape × s + t); BENT: the spines as they are now (see bend)
  let SPINES_SVG = [], SPINES = [], SP = [], SPID = [], FLAG = [], RT = [], HUB = [], REACH = [], FIT = { tx: 0, ty: 0, s: 1 }, BENT = null;
  const RS = new Float32Array(MAXP * 4);
  const fadeAt = i => FADE_PX && i >= 0 && FADE_PX[i * 4 + 3] ? FADE_PX[i * 4] / 255 * FADE_PX[i * 4 + 3] / 255 : 0;   // (0 none … 1 gone)
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
      pts.hub = el.hasAttribute('data-fur-hub'); pts.reach = +el.getAttribute('data-fur-reach') || 0; return pts;
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
    // fade (data-fur-fade: a grey picture, white where the fur fades out, hairs and base alike): where a part lies over another and should
    // melt into it with no edge (a leg's round top on the body). Only fade pictures, then left out of the others
    let fadeSrc = null;
    if (g.querySelector('[data-fur-fade]')) {
      const L = g.cloneNode(true);
      L.querySelectorAll('path,ellipse,circle,rect,polygon,polyline,line,text,use,image').forEach(el => { if (!el.closest('[data-fur-fade]') && !el.closest('defs')) el.remove(); });
      fadeSrc = L.innerHTML;
      for (const r of [g, outline]) r.querySelectorAll('[data-fur-fade]').forEach(el => el.remove());
    }
    const bb = outline.getBBox(), maskSrc = outline.innerHTML, colorSrc = g.innerHTML;
    holder.remove();
    if (!bb.width || !bb.height) throw new Error('The shape is empty');
    const M = o.margin, s = Math.min((W - 2 * M) / bb.width, (H - 2 * M) / bb.height);
    const tx = (W - bb.width * s) / 2 - bb.x * s, ty = (H - bb.height * s) / 2 - bb.y * s;
    if (spines.flat().length > MAXP) throw new Error(`Too many spine points (${MAXP} at most)`);
    FIT = { tx, ty, s }; SPINES_SVG = spines; SPINES = spines.map(p => p.map(([x, y]) => [tx + x * s, ty + y * s])); HUB = spines.map(p => !!p.hub); REACH = spines.map(p => p.reach * s);
    const raster = async (inner, force, n = GN) => {
      const str = `<svg xmlns="${SVGNS}" width="${n}" height="${n}" viewBox="0 0 ${W} ${H}">` +
        (force ? '<style>*{fill:#000!important;fill-opacity:1!important;opacity:1!important}</style>' : '') +
        `<g transform="translate(${tx} ${ty}) scale(${s})">${inner}</g></svg>`;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = n;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, n, n);
      return x.getImageData(0, 0, n, n).data;
    };
    const hpx = await raster(maskSrc, true, BN); COV = new Uint8Array(BN * BN);   // (the outline, finer and anti-aliased, for the soft base)
    for (let i = 0; i < BN * BN; i++) COV[i] = hpx[i * 4 + 3];
    const mpx = await raster(maskSrc, true), m = new Uint8Array(NC);
    for (let i = 0; i < NC; i++) m[i] = mpx[i * 4 + 3] > 127 ? 1 : 0;
    SVG_PX = await raster(colorSrc, false);                         // the SVG's own colours
    LIGHT_PX = lightSrc ? await raster(lightSrc, false) : null;     // the light, if given
    FADE_PX = fadeSrc ? await raster(fadeSrc, false) : null;        // the fade, if given
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
      // the base is as bright as the hairs over it are on average (strand variation and the edge's rim lighten them, see makeLines), so
      // where the hair is thinner (inside, or stretched as a part bends) it doesn't show as a darker patch
      const e = IN[i] ? edgeOf(SDF[i]) : 1, cr = e + (1 - e) * o.crisp, jm = 1 + o.rim * e + o.variation * 0.35 * (cr * (1 + 0.4 * (1 - e)) + (1 - cr) * 0.6);
      for (let q = 0; q < 3; q++) {
        const a = S4 ? S4[i * 4 + 3] : 0;
        const base = S4 && a > 0.05 ? S4[i * 4 + q] / a : ci[q] + (co[q] - ci[q]) * u;
        const c = base * k; COL[i * 3 + q] = c; C[i * 4 + q] = c * jm;
      }
      if (S4o && !IN[i] && S4o[i * 4 + 3] > 0.05) for (let q = 0; q < 3; q++) COL[i * 3 + q] = S4o[i * 4 + q] / S4o[i * 4 + 3] * k;   // (hair only: the base keeps the shape's)
      C[i * 4 + 3] = 1;
    }
    boxBlur(C, GN, GN, 3); boxBlur(C, GN, GN, 3);
    BASE_RGB = C;
  }

  // the soft base's signed distance to the outline (stage units, + inside), on its finer grid: whole pixels from a distance transform,
  // and right at the outline from how much of the pixel the drawing covers, so the edge is smooth
  function prepBaseField() {
    const n = BN * BN, din = new Float32Array(n), dout = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = COV[i] > 127; din[i] = a ? 1e9 : 0; dout[i] = a ? 0 : 1e9; }
    chamfer(din, null, BN); chamfer(dout, null, BN);
    SDFB = new Float32Array(n);
    for (let y = 0; y < BN; y++) for (let x = 0; x < BN; x++) {
      const i = y * BN + x, a = COV[i] > 127;
      const edge = (x > 0 && (COV[i - 1] > 127) !== a) || (x < BN - 1 && (COV[i + 1] > 127) !== a) || (y > 0 && (COV[i - BN] > 127) !== a) || (y < BN - 1 && (COV[i + BN] > 127) !== a);
      SDFB[i] = (edge ? COV[i] / 255 - 0.5 : a ? din[i] - 0.5 : -(dout[i] - 0.5)) * BS;
    }
  }

  /* --- soft base: alpha = smooth step across the outline --- */
  function paintBase() {
    const b = baseCv.getContext('2d'), img = b.createImageData(BN, BN);
    const z = Z(), w = Math.max(o.blur * z, 0.01), k = o.keepShape === true ? 0 : typeof o.keepShape === 'number' ? o.keepShape * z : o.keepShape, lo = typeof k === 'number' ? Math.min((o.edgeInset - o.blur / 2) * z, k - w) : (o.edgeInset - o.blur / 2) * z;   // (keepShape: solid by then at the latest)
    for (let y = 0; y < BN; y++) for (let x = 0; x < BN; x++) {
      const j = y * BN + x, gx = clamp((x + 0.5) * GN / BN - 0.5, 0, GN - 1), gy = clamp((y + 0.5) * GN / BN - 0.5, 0, GN - 1);
      const x0 = gx | 0, y0 = gy | 0, x1 = Math.min(x0 + 1, GN - 1), y1 = Math.min(y0 + 1, GN - 1), fx = gx - x0, fy = gy - y0;
      const t = clamp((SDFB[j] - lo) / w, 0, 1), al = t * t * (3 - 2 * t) * (1 - fadeAt(Math.round(gy) * GN + Math.round(gx)));
      if (al <= 0) continue;
      const a = (y0 * GN + x0) * 4, bq = (y0 * GN + x1) * 4, c = (y1 * GN + x0) * 4, d = (y1 * GN + x1) * 4;   // (its colour: the grid's, in between)
      for (let q = 0; q < 3; q++) img.data[j * 4 + q] = (BASE_RGB[a + q] * (1 - fx) + BASE_RGB[bq + q] * fx) * (1 - fy) + (BASE_RGB[c + q] * (1 - fx) + BASE_RGB[d + q] * fx) * fy;
      img.data[j * 4 + 3] = al * 255;
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
    RS.fill(0); SP.forEach((q, k) => RS.set([q[0], q[1], SPID[k], FLAG[k] | (HUB[SPID[k]] ? 4 : 0)], k * 4));   // (the spines as drawn, which spine each point is on, its ends (1, 2) and the hub's (4), for the shaders)
  }
  // a spot in the frame of segment k at t: [segment (index of its first point in SP), t (past 0 / 1 beyond a spine's ends), offset along, offset across, direction]
  // The frame runs along the smooth curve through the spine's points (as the shaders: Catmull-Rom, a spine's end point mirrored), so a
  // spine bent at its points bends the fur round, not at corners. As drawn, any t gives the spot back exactly, whatever the curve
  function crAt(k, t) {
    const p1 = SP[k], p2 = SP[k + 1], p0 = FLAG[k] & 1 ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : SP[k - 1], p3 = FLAG[k + 1] & 2 ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : SP[k + 2];
    const P = [0, 0], D = [0, 0];
    for (let q = 0; q < 2; q++) { const a = 2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q], b = -p0[q] + 3 * p1[q] - 3 * p2[q] + p3[q], c = p2[q] - p0[q];
      P[q] = 0.5 * (2 * p1[q] + c * t + a * t * t + b * t * t * t); D[q] = 0.5 * (c + 2 * a * t + 3 * b * t * t); }
    return [P, D];
  }
  function segSpot(k, t, x, y) {
    const tc = clamp(t, 0, 1), [P, D] = crAt(k, tc), l = Math.hypot(D[0], D[1]) || 1, T = [D[0] / l, D[1] / l];
    const ext = (t - tc) * Math.hypot(SP[k + 1][0] - SP[k][0], SP[k + 1][1] - SP[k][1]);   // (past a spine's end: on along its end direction)
    const rx = x - P[0] - T[0] * ext, ry = y - P[1] - T[1] * ext;
    return [k, t, rx * T[0] + ry * T[1], ry * T[0] - rx * T[1], Math.atan2(T[1], T[0])];
  }
  // the segments a spot goes with, and how much of each: up to SPK of them, every share changing smoothly from spot to spot,
  // so neighbouring fur always moves together and never tears (a knee goes with both its bones; where a leg or the neck meets
  // the hub, both spines). → SPK spots (segment, t, along, across), then their shares
  //  · within a spine: each segment by how much farther it is than the spine's nearest (none past BLEND)
  //  · between spines: the hub and a part blend across BLEND_HUB; two parts that are not the hub (two legs) only across BLEND,
  //    which happens only in the empty space between them
  //  · the shares are cut to the SPK biggest by taking off the next one's, so a segment coming in or going out starts at 0
  const BLEND = 24, BLEND_HUB = 30, SPK = 4, SPF = SPK * 5;   // (stage units; across a hub join: shape units, as the part is drawn (60 stage units without unit))
  const fall = u => u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);   // 1 → 0, smoothly
  function spineAt(x, y) {
    const near = [], ds = SPINES.map(() => Infinity);
    for (let j = 0; j < SP.length - 1; j++) {
      if (FLAG[j] & 2) continue;                                  // (last point of a spine: no segment starts here)
      const A = SP[j], B = SP[j + 1], dx = B[0] - A[0], dy = B[1] - A[1], u = ((x - A[0]) * dx + (y - A[1]) * dy) / (dx * dx + dy * dy || 1e-9);
      // past a spine's end a spot goes on along its last direction (uc), but how near it is counts from the end itself,
      // so the line running on never takes spots from another part lying further along it
      const uc = clamp(u, FLAG[j] & 1 ? -Infinity : 0, FLAG[j + 1] & 2 ? Infinity : 1), ud = clamp(u, 0, 1);
      // (a spine with a reach (data-fur-reach, shape units) is that much nearer, so a body's line along its back owns all of the body;
      // past the spine's ends the reach fades within 0.1 of itself, so what grows on from there (a neck) stays its own)
      const R = REACH[SPID[j]] || 0, over = R ? Math.max(FLAG[j] & 1 ? -u : 0, FLAG[j + 1] & 2 ? u - 1 : 0, 0) * Math.sqrt(dx * dx + dy * dy) : 0;
      const d = Math.hypot(x - A[0] - dx * ud, y - A[1] - dy * ud) - R * clamp(1 - over / (0.1 * R || 1), 0, 1);
      near.push([j, uc, d, 0]); if (d < ds[SPID[j]]) ds[SPID[j]] = d;
    }
    let dh = Infinity, dn = Infinity; ds.forEach((d, s) => { if (HUB[s]) dh = Math.min(dh, d); else dn = Math.min(dn, d); });
    const hubW = o.unit > 0 ? BLEND_HUB * FIT.s : 60, d0 = Math.min(dh, dn);
    const om = ds.map((d, s) => HUB[s] ? fall((d - d0) / hubW) : fall((d - dh) / hubW) * fall((d - dn) / BLEND)), sum = ds.map(() => 0);
    let all = 0; om.forEach(w => all += w);
    for (const n of near) { const s = SPID[n[0]]; n[3] = om[s] > 0 ? fall((n[2] - ds[s]) / BLEND) : 0; sum[s] += n[3]; }
    const top = near.filter(n => n[3] > 0).map(n => (n[3] *= om[SPID[n[0]]] / sum[SPID[n[0]]] / all, n)).sort((a, b) => b[3] - a[3]);
    const cut = top.length > SPK ? top[SPK][3] : 0, out = new Array(SPF).fill(0);
    let tot = 0; for (let k = 0; k < SPK && k < top.length; k++) tot += top[k][3] - cut;
    for (let k = 0; k < SPK && k < top.length; k++) {
      const n = top[k], S = segSpot(n[0], n[1], x, y);
      out[k * 4] = S[0]; out[k * 4 + 1] = S[1]; out[k * 4 + 2] = S[2]; out[k * 4 + 3] = S[3];
      out[SPK * 4 + k] = tot > 1e-9 ? (n[3] - cut) / tot : k === 0 ? 1 : 0;
    }
    return out;
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
          const fd = fadeAt(i); if (fd > 0.98) continue;
          list.push({ x, y, a, len, op: (P.op[0] + P.op[1] * rand()) * (1 - fd), hw: (0.75 + 0.35 * rand()) * q.hw * (rim ? 0.75 : 1),
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
  const uH = U(prog, 'px', 'bent', 'k', 'view', 'sp', 'rs', 'floor'), uB = U(progB, 'k', 'view', 'sp', 'rs', 'tex', 'floor', 'fsoft', 'layer');
  // the bent base: grid (x, y, then its spine spots and their shares: 2 + SPF floats a point), and the base picture as a texture
  const vaoB = gl.createVertexArray(), gridBuf = gl.createBuffer(), idxBuf = gl.createBuffer(), tex = gl.createTexture(); let nIdx = 0;
  gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
  [[0, 2, 0], [1, 4, 8], [2, 4, 24], [3, 4, 40], [4, 4, 56], [5, 4, 72]].forEach(([l, n, ofs]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, (2 + SPF) * 4, ofs); });
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
  const spBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, spBuf);   // each hair's spine spots and shares (SPF floats, see spineAt)
  [5, 6, 7, 8, 9].forEach(l => { gl.enableVertexAttribArray(l); gl.vertexAttribDivisor(l, 1); });
  // the hairs from the s-th on (WebGL2 has no first instance: the per-hair attributes start there instead)
  function hairsFrom(s) {
    gl.bindBuffer(gl.ARRAY_BUFFER, statBuf); [[1, 0], [2, 16], [3, 32]].forEach(([l, ofs]) => gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, s * 48 + ofs));
    gl.bindBuffer(gl.ARRAY_BUFFER, offBuf); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, s * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, spBuf); [5, 6, 7, 8, 9].forEach((l, k) => gl.vertexAttribPointer(l, 4, gl.FLOAT, false, SPF * 4, s * SPF * 4 + k * 16));
  }
  hairsFrom(0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // the base's grid for the shape's spines (built with the shape), and its picture (sent again each time it is painted)
  function prepGrid() {
    if (!SP.length) { nIdx = 0; return; }
    const G = 64, F = 2 + SPF, v = new Float32Array((G + 1) ** 2 * F), part = new Int32Array((G + 1) ** 2), idx = new Uint16Array(G * G * 6);
    for (let y = 0; y <= G; y++) for (let x = 0; x <= G; x++) {
      const px = x / G * W, py = y / G * H, s = spineAt(px, py), i = y * (G + 1) + x;
      v[i * F] = px; v[i * F + 1] = py; v.set(s, i * F + 2);
      // the part it goes with when the hub has none of it (-1: the hub holds some, so it stays with the rest), -2 if two parts
      // (only in the empty space between two legs)
      let m = -1, hub = false; for (let k = 0; k < SPK; k++) { const sp = SPID[s[k * 4]]; if (s[SPK * 4 + k] > 0) if (HUB[sp]) hub = true; else m = m === -1 || m === sp ? sp : -2; }
      part[i] = hub ? -1 : m;
    }
    // a triangle between two parts that are not the hub (two legs) would stretch over the gap between them as they move apart:
    // left out (only empty space lies there). Everything else is whole: the fur's shares change smoothly, so the base only stretches
    const ok = (a, b) => part[a] === -1 || part[b] === -1 || part[a] === part[b];
    const fits = (a, b, c) => part[a] !== -2 && part[b] !== -2 && part[c] !== -2 && ok(a, b) && ok(b, c) && ok(a, c);
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

  let N = 0, X, Y, A, OFF, TGT, ACT, active = [], cells, buildMs = 0, fps = 0, PARTS = [];   // (PARTS: each spine's hairs, [first, count])
  const CELL = 64, GWc = Math.ceil(W / CELL);
  function build() {
    if (!IN) return;
    const t0 = performance.now(), lines = makeLines();
    // each hair's spine spots, and the part it belongs to (the spine holding most of it). The hairs are kept together by part (in
    // their order within it: edge first, inner on top), so a part's fur can lie over or under another's as a whole (see bend's z)
    if (SP.length) {
      for (const l of lines) { l.sp = spineAt(l.x, l.y); const own = SPINES.map(() => 0);
        for (let k = 0; k < SPK; k++) own[SPID[l.sp[k * 4]]] += l.sp[SPK * 4 + k];
        // (its layer: a part's that holds LEG_LAYER of it or more, else the one holding most; the hub (the body) moves the fur round a
        // hip or shoulder, but that fur is the leg's in the layers, so the top of a leg lies over or under another leg as the leg does)
        let lp = -1; own.forEach((v, j) => { if (!HUB[j] && v >= LEG_LAYER && (lp < 0 || v > own[lp])) lp = j; });
        l.part = lp >= 0 ? lp : own.indexOf(Math.max(...own));
        let m = 0; for (let k = 1; k < SPK; k++) if (l.sp[SPK * 4 + k] > l.sp[SPK * 4 + m]) m = k; l.seg = l.sp[m * 4]; }
      lines.sort((a, b) => a.part - b.part || b.seg - a.seg);   // (within a part, its bones from the far end in: the one above lies over the one below where a joint folds)
    }
    N = lines.length; PARTS = SPINES.map(() => [0, 0]);
    lines.forEach((l, i) => { const P = PARTS[l.part || 0]; if (P && !P[1]++) P[0] = i; });
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
    const spd = new Float32Array(N * SPF);
    if (SP.length) lines.forEach((s, i) => spd.set(s.sp, i * SPF));
    gl.bindBuffer(gl.ARRAY_BUFFER, spBuf); gl.bufferData(gl.ARRAY_BUFFER, spd, gl.STATIC_DRAW);
    buildMs = Math.round(performance.now() - t0);
    draw();
  }
  function draw() {
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const view = BENT ? BENT.view : [0, 0, W, H], k = 1 / FIT.s;
    // bent: the soft base is drawn here (its own canvas is hidden), all of it first; then each part's hairs, back to front by z,
    // each part after the first laying its own soft base over the fur behind it first (only where it is that part)
    const base = layer => {
      if (!BENT || !nIdx) return;
      gl.useProgram(progB); gl.bindVertexArray(vaoB);
      gl.uniform1f(uB.k, k); gl.uniform1f(uB.floor, BENT.floor); gl.uniform1f(uB.fsoft, 0.5 * o.hairMax * Z() * k);   // (fsoft: the soft base fades out over half a long hair above the floor)
      gl.uniform4fv(uB.view, view); gl.uniform4fv(uB.sp, BENT.sp); gl.uniform4fv(uB.rs, RS); gl.uniform1i(uB.tex, 0); gl.uniform1i(uB.layer, layer);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      // (all of it: where it lies over itself (a tight curl, a leg folded up to the belly) each pixel keeps the more solid of the two,
      // so no edge of it shows inside; a part's layer over the fur behind it: laid over it)
      if (layer < 0) gl.blendEquation(gl.MAX);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
      gl.blendEquation(gl.FUNC_ADD);
    };
    base(-1);
    if (!N) { gl.bindVertexArray(vaoH); return; }
    gl.useProgram(prog); gl.bindVertexArray(vaoH);
    gl.uniform1f(uH.px, cv.width / view[2]); gl.uniform4fv(uH.view, view); gl.uniform1f(uH.bent, BENT ? 1 : 0); gl.uniform1f(uH.k, k); gl.uniform1f(uH.floor, BENT ? BENT.floor : 1e9);
    if (BENT) { gl.uniform4fv(uH.sp, BENT.sp); gl.uniform4fv(uH.rs, RS); }
    if (!BENT || PARTS.length < 2) { hairsFrom(0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, VERTS, N); return; }
    const z = PARTS.map((P, j) => BENT.z && typeof BENT.z[j] === 'number' ? BENT.z[j] : HUB[j] ? -1 : j);   // (no z given: the hub at the back, the rest in order)
    const order = PARTS.map((P, j) => j).filter(j => PARTS[j][1]).sort((a, b) => z[a] - z[b] || a - b);
    order.forEach((j, n) => {
      if (n) { base(j); gl.useProgram(prog); gl.bindVertexArray(vaoH); }
      hairsFrom(PARTS[j][0]); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, VERTS, PARTS[j][1]);
    });
    hairsFrom(0);
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
      prepSpines(); prepGrid(); prepField(); prepBaseField(); prepColors(); paintBase(); build();
    },
    // the shape's spines as they are now: one list of points per data-fur-spine line (same order and counts), each point
    // [x, y] or [x, y, width scale], in the units of view {x, y, width, height} (the rectangle the canvas shows; keep it the
    // canvas's shape). view left out: the stage in the shape's own units. null: back to the shape as drawn. Only redraws.
    // floor (optional, a y in view units): nothing goes below it; hairs that would bend aside to lie along it, each hair's floor a little
    // above the line so the edge there is ragged like fur; the soft base fades out just above it
    // z (optional, a number per spine): which part's fur lies over which where they cross, higher in front (left out: the hub at the back)
    bend(spines, view, floor, z) {
      if (!spines || !SPINES.length) { BENT = null; baseCv.style.visibility = ''; draw(); return; }
      if (spines.length !== SPINES.length || spines.some((p, j) => p.length !== SPINES[j].length)) throw new Error('bend needs the shape\'s spines, point for point');
      const sp = BENT?.sp || new Float32Array(MAXP * 4); let n = 0;
      spines.forEach(p => p.forEach((q, i) => sp.set([q[0], q[1], q[2] ?? 1, (i === 0 ? 1 : 0) | (i === p.length - 1 ? 2 : 0)], 4 * n++)));
      const v = view || { x: -FIT.tx / FIT.s, y: -FIT.ty / FIT.s, width: W / FIT.s, height: H / FIT.s };
      BENT = { sp, view: [v.x, v.y, v.width, v.height], floor: typeof floor === 'number' ? floor : 1e9, z: Array.isArray(z) ? [...z] : null };
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
