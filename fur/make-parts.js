// Snapshots Gav's parts from cat-stretch.html into gav-parts.js for the fur page, in both coats:
//   head (sitting, face front, with the face stain on the Siamese) and ears (the dark outer ear), inner ears (the pink part
//   on top, with the dark ear round it as colour; Siamese only: the black cat has none), neck, body + belly, legs, tail (standing),
//   each with its spine (the line it bends along: data-fur-spine) and a flow source where its fur starts.
// Run again after changing a part's drawing:  node fur/make-parts.js
// Uses file:// so nothing is saved into the project (see tools/edit_server.py).
const path = require('path'), fs = require('fs');
const { chromium } = require('/Users/michael/git/casematch/node_modules/playwright-core');
const ROOT = path.resolve(__dirname, '..');

// runs in the page: the parts as they are drawn now (catBody units)
function snap(which) {
  const $ = id => document.getElementById(id), S = catDebug.settings, p = catDebug.shown, NS = 'http://www.w3.org/2000/svg';
  const f = v => +v.toFixed(2), Mx = m => `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(v => +v.toFixed(4)).join(' ')})`;
  const inv = $('catBody').getCTM().inverse(), toBody = el => inv.multiply(el.getCTM());
  const shown = el => { for (let e = el; e && e.id !== 'catBody'; e = e.parentNode) if (getComputedStyle(e).display === 'none') return false; return true; };
  const refsOf = (el, set) => { for (const x of [el, ...el.querySelectorAll('*')]) for (const a of x.attributes) {
    for (const m of a.value.matchAll(/url\(["']?#([^)"']+)["']?\)/g)) set.add(m[1]);
    if (/(^|:)href$/.test(a.name) && a.value.startsWith('#')) set.add(a.value.slice(1));
  } };
  const holder = markup => { const h = document.createElementNS(NS, 'svg'); h.setAttribute('style', 'position:absolute;left:-99999px;top:0;visibility:hidden');
    h.innerHTML = markup; document.body.appendChild(h); return h; };

  if (which === 'head') {   // (as make-head.js did)
    const skull = $('skull'), face = $('ptFace'), stain = face.stain, sia = S.coat === 'siamese';
    const toSkull = el => skull.getCTM().inverse().multiply(el.getCTM());
    const nose = face.querySelector('[fill="url(#noseBody)"]'), nb = nose.getBBox();
    const n = new DOMPoint(nb.x + nb.width / 2, nb.y + nb.height / 2).matrixTransform(toSkull(nose));
    const fill = getComputedStyle(skull).fill, svg = `<svg xmlns="${NS}">` + (sia ? `<defs>${$('stainMap').outerHTML}</defs>` : '') +
      `<path data-fur-shape="" fill="${fill}" d="${skull.getAttribute('d')}"/>` +
      (sia ? `<g transform="${Mx(toSkull(stain))}"><path filter="url(#stainMap)" d="${stain.getAttribute('d')}"/></g>` : '') + (window.__L ? window.__L.head : '') + '</svg>';
    const sc = el => { const m = el.getCTM(); return Math.hypot(m.a, m.b); };
    return { svg, from: [[n.x, n.y]], bg: S.bgColor, scale: +(sc(skull) / sc($('catBody'))).toFixed(4), light: window.__L ? window.__L.head : '' };   // (scale: body units per head unit; light: the head's share of the one light)
  }

  // one item: Gav's elements as drawn (catBody units), shape: the ones that make the outline, and its spine
  const item = (els, shape, spine) => {
    let s = '', outline = ''; const refs = new Set();
    for (const el of els) {
      if (!el || !shown(el)) continue;
      const c = el.cloneNode(true), o = [el, ...el.querySelectorAll('*')], cl = [c, ...c.querySelectorAll('*')];
      o.forEach((e, i) => { if (i && getComputedStyle(e).display === 'none') cl[i].setAttribute('display', 'none'); });
      if (shape.includes(el)) c.setAttribute('data-fur-shape', '');
      refsOf(c, refs);
      const g = `<g transform="${Mx(toBody(el.parentNode))}">${c.outerHTML}</g>`;
      s += g; if (shape.includes(el)) outline += g;
    }
    return { s, outline, refs, spine: spine.map(q => [f(q[0]), f(q[1])]) };
  };
  const pathPts = el => { const m = toBody(el), n = (el.getAttribute('d') || '').match(/-?[\d.]+/g).map(Number), out = [];
    for (let i = 0; i + 1 < n.length; i += 2) { const q = new DOMPoint(n[i], n[i + 1]).matrixTransform(m); out.push([q.x, q.y]); }
    return out; };
  const fewer = (P, k) => Array.from({ length: k }, (_, i) => P[Math.round(i * (P.length - 1) / (k - 1))]);
  const leg = k => ({ ...item([$('leg-' + k), $('low-' + k), $('ptLow-' + k)?.parentNode], [$('leg-' + k), $('low-' + k)], p.legs[k]), far: k[1] === 'f' });   // (far: the pair behind the body, its own light)
  const bodyItem = () => item(['body', 'massRib', 'massPel', 'bellyBlob', 'bellyShade'].map($), ['body', 'massRib', 'massPel', 'bellyBlob'].map($), p.skel.spine);
  const neckItem = () => item([$('neck')], [$('neck')], [p.neck, [p.head.x, p.head.y + HEAD_DROP]]);
  const whole = which === 'fullBody';   // neck, body + belly and the four legs where Gav has them, painted in his order: one fur over all of them
  const L = whole ? [leg('bf'), leg('ff'), bodyItem(), neckItem(), leg('bn'), leg('fn')]
    : which === 'ears' || which === 'innerEars' ? [['earL', 'ptInnerL', 'earSpineL'], ['earR', 'ptInnerR', 'earSpineR']]   // (the two layers: same spines)
      .map(([o, i, sp]) => which === 'ears' ? item([$(o)], [$(o)], fewer(pathPts($(sp)), 6))
        : item([$(o), $(i)], [$(i)], fewer(pathPts($(sp)), 6)))   // (inner ears: the dark ear round each only gives colour, to the hairs that lie in over it)
    : which === 'neck' ? [neckItem()]
    : which === 'body' ? [bodyItem()]
    : which === 'legs' ? ['bf', 'bn', 'ff', 'fn'].map(leg)
    : [item([$('tail'), $('ptTailCoat')], [$('tail')], p.tail)];
  if (L.every(it => !it.outline)) return null;   // (nothing of it in this coat)
  // side by side (legs: two rows, the back pair over the front pair), apart enough that every spot of each lies nearer its own spine than any other (a round shoulder reaches far from its spine)
  const perRow = which === 'legs' ? 2 : L.length, GAP = 42, boxes = L.map(it => { const h = holder(`<g>${it.outline}</g>`), b = h.firstChild.getBBox(); h.remove(); return b; });   // (the outline only: colour bands are bigger, cut to it)
  let body = '', y = null; const spines = [], refs = new Set();
  for (let r = 0; r * perRow < L.length; r++) {
    const row = L.slice(r * perRow, (r + 1) * perRow), rb = boxes.slice(r * perRow, (r + 1) * perRow), top = Math.min(...rb.map(b => b.y));
    const dy = whole || y === null ? 0 : y - top; let x = null;
    row.forEach((it, i) => {
      const b = rb[i], dx = whole || x === null ? 0 : x - b.x; x = (x === null ? b.x : x) + b.width + GAP;
      body += `<g transform="translate(${f(dx)} ${f(dy)})">${it.s}${window.__L ? window.__L.crop(b, it.far) : ''}<polyline data-fur-spine="" fill="none" points="${it.spine.map(q => q[0] + ',' + q[1]).join(' ')}"/></g>`;
      spines.push(it.spine.map(q => [f(q[0] + dx), f(q[1] + dy)]));
      it.refs.forEach(k => refs.add(k));
    });
    y = (y === null ? top : y) + Math.max(...rb.map(b => b.y + b.height)) - top + GAP;
  }
  // what they refer to (gradients, filters, clips, masks), with what those refer to in turn
  const have = new Set([...body.matchAll(/ id="([^"]+)"/g)].map(m => m[1])), done = new Set(), defs = [];
  const add = id => { if (done.has(id) || have.has(id)) return; done.add(id); const e = $(id); if (!e) return; const r = new Set(); refsOf(e, r); r.forEach(add); defs.push(e.outerHTML); };
  refs.forEach(add);
  // fur starts at the root of each: legs, tail, ears at their first point; neck and body from the head's end
  const from = spines.map((s, i) => which === 'neck' || which === 'body' || (whole && (i === 2 || i === 3)) ? s[s.length - 1] : s[0]);
  return { svg: `<svg xmlns="${NS}"><defs>${defs.join('')}</defs>${body}</svg>`, spines, from };
}

// in the page, standing: one light over Gav's whole outline (body units), so the fur is shaded as one cat, not part by part. His
// outline is puffed up into a soft round surface (a spot R units in from the edge is as high as it gets: a leg is a round tube,
// the body a cushion with a flat top) and lit from straight above and a little from the front: how much each spot is darkened
// (0…1, times a part's Shading). The far legs get their own (with the body they come from), as they are seen behind the near ones.
// Each part gets its piece of it (data-fur-light, an image under its own box, carried with it when the parts are laid out apart);
// fur.js shades with it instead of with the part's own outline. The head gets its piece in its own units.
async function makeLight() {
  const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
  const Mx = m => `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(v => +v.toFixed(4)).join(' ')})`, f = v => +v.toFixed(2);
  const inv = $('catBody').getCTM().inverse(), toBody = el => inv.multiply(el.getCTM());
  const R = 16, LIGHT = [0, -0.6, 0.8];   // (how far in the surface rounds off, units; the light's direction: up, toward you)
  const BODY = ['tail', 'body', 'massRib', 'massPel', 'bellyBlob', 'neck', 'earL', 'earR', 'skull'], FAR = ['leg-bf', 'low-bf', 'leg-ff', 'low-ff'], NEAR = ['leg-bn', 'low-bn', 'leg-fn', 'low-fn'];
  const svgOf = ids => ids.map($).filter(e => e && getComputedStyle(e).display !== 'none').map(e => `<g transform="${Mx(toBody(e.parentNode))}">${e.outerHTML}</g>`).join('');
  const h = document.createElementNS(NS, 'svg'); h.setAttribute('style', 'position:absolute;left:-99999px;top:0;visibility:hidden'); h.innerHTML = `<g>${svgOf([...BODY, ...FAR, ...NEAR])}</g>`;
  document.body.appendChild(h); const b = h.firstChild.getBBox(); h.remove();
  const pad = 30, x0 = b.x - pad, y0 = b.y - pad, W = Math.ceil(b.width + 2 * pad), H = Math.ceil(b.height + 2 * pad), N = W * H;
  const blur = (a, r) => { const t = new Float32Array(N);
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x < W + r; x++) { if (x + r < W) s += a[y * W + x + r]; if (x - r - 1 >= 0) s -= a[y * W + x - r - 1]; if (x >= 0 && x < W) t[y * W + x] = s / (2 * r + 1); } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y < H + r; y++) { if (y + r < H) s += t[(y + r) * W + x]; if (y - r - 1 >= 0) s -= t[(y - r - 1) * W + x]; if (y >= 0 && y < H) a[y * W + x] = s / (2 * r + 1); } } };
  const lightOf = async ids => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="${x0} ${y0} ${W} ${H}">` +
      `<style>*{fill:#000!important;fill-opacity:1!important;opacity:1!important;stroke:none!important;filter:none!important}</style>${svgOf(ids)}</svg>`);
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, W, H).data, IN = new Uint8Array(N); for (let i = 0; i < N; i++) IN[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    // distance in from the outline; outside spots remember the nearest inside one
    const din = new Float32Array(N), dout = new Float32Array(N), near = new Int32Array(N);
    for (let i = 0; i < N; i++) { din[i] = IN[i] ? 1e9 : 0; dout[i] = IN[i] ? 0 : 1e9; near[i] = IN[i] ? i : -1; }
    const F = [[-1, 0, 1], [-1, -1, 1.414], [0, -1, 1], [1, -1, 1.414]];
    for (const [d, nr] of [[din, null], [dout, near]]) for (const dir of [1, -1]) for (let k = 0; k < N; k++) {
      const i = dir > 0 ? k : N - 1 - k, x = i % W, y = i / W | 0;
      for (const [fx, fy, c] of F) { const X = x + fx * dir, Y = y + fy * dir; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X;
        if (d[j] + c < d[i]) { d[i] = d[j] + c; if (nr) nr[i] = nr[j]; } }
    }
    // the puffed-up surface (round over its first R units in), smoothed, and its slope
    const Z = new Float32Array(N); for (let i = 0; i < N; i++) { const d = IN[i] ? Math.min(din[i] - 0.5, R) : 0; Z[i] = Math.sqrt(Math.max(0, R * R - (R - d) * (R - d))); }
    blur(Z, 1); blur(Z, 1);
    const out = cx.createImageData(W, H), shade = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!IN[i]) continue;
      const gx = (Z[y * W + Math.min(W - 1, x + 1)] - Z[y * W + Math.max(0, x - 1)]) / 2, gy = (Z[Math.min(H - 1, y + 1) * W + x] - Z[Math.max(0, y - 1) * W + x]) / 2;
      const l = Math.hypot(gx, gy, 1), lit = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / l;
      shade[i] = Math.min(1, Math.max(0, (LIGHT[2] - lit) / 1.1)); }   // (facing you: none, facing up: a little, side on: more, facing down: all)
    for (let i = 0; i < N; i++) { const v = Math.round(255 * shade[near[i] >= 0 ? near[i] : i]); out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
    cx.putImageData(out, 0, 0);
    return cv;
  };
  const maps = { near: await lightOf([...BODY, ...NEAR]), far: await lightOf([...BODY, ...FAR]) };
  // a piece of it (box in body units, a little round it), as an image in body units
  const crop = (bb, far, m = 12) => {
    const X0 = Math.max(0, Math.floor(bb.x - m - x0)), Y0 = Math.max(0, Math.floor(bb.y - m - y0)), X1 = Math.min(W, Math.ceil(bb.x + bb.width + m - x0)), Y1 = Math.min(H, Math.ceil(bb.y + bb.height + m - y0));
    if (X1 <= X0 || Y1 <= Y0) return '';
    const c = document.createElement('canvas'); c.width = X1 - X0; c.height = Y1 - Y0; c.getContext('2d').drawImage(far ? maps.far : maps.near, X0, Y0, c.width, c.height, 0, 0, c.width, c.height);
    return `<image data-fur-light="" preserveAspectRatio="none" x="${f(x0 + X0)}" y="${f(y0 + Y0)}" width="${c.width}" height="${c.height}" href="${c.toDataURL('image/png')}"/>`;
  };
  // the head: its box in body units, placed in the skull's own units (as it stands)
  const sk = $('skull'), sb = sk.getBBox(), m = toBody(sk), cs = [[sb.x, sb.y], [sb.x + sb.width, sb.y], [sb.x, sb.y + sb.height], [sb.x + sb.width, sb.y + sb.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const hb = { x: Math.min(...cs.map(q => q.x)), y: Math.min(...cs.map(q => q.y)) }; hb.width = Math.max(...cs.map(q => q.x)) - hb.x; hb.height = Math.max(...cs.map(q => q.y)) - hb.y;
  const toSkull = sk.getCTM().inverse().multiply($('catBody').getCTM());
  window.__L = { crop, head: `<g data-fur-light="" transform="${Mx(toSkull)}">${crop(hb, false, 16)}</g>` };
}

// in the page: where points land in fur.js's stage (0–1), as it fits the outline (margin 110)
function stagePoints([svg, pts]) {
  const NS = 'http://www.w3.org/2000/svg', h = document.createElementNS(NS, 'svg');
  h.setAttribute('style', 'position:absolute;left:-99999px;top:0;visibility:hidden');
  h.innerHTML = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.innerHTML;
  document.body.appendChild(h);
  if (h.querySelector('[data-fur-shape]')) h.querySelectorAll('path,ellipse,circle,rect,polygon,polyline,line,text,use,image')
    .forEach(el => { if (!el.closest('[data-fur-shape]') && !el.closest('defs')) el.remove(); });
  const b = h.getBBox(); h.remove();
  const s = Math.min(560 / b.width, 560 / b.height), tx = (780 - b.width * s) / 2 - b.x * s, ty = (780 - b.height * s) / 2 - b.y * s;
  return pts.map(([x, y]) => ({ x: +((tx + x * s) / 780).toFixed(4), y: +((ty + y * s) / 780).toFixed(4), type: 'source', strength: 1 }));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  // a still cat: a clock that only moves when stepped and the same 'random' numbers every run (breathing, the tail's sway), so the same
  // drawing always gives the same snapshot (the edit server makes it again after saves, and only a real change should reach the fur)
  await page.addInitScript(() => {
    let T = 1000, q = [], r = 7;
    performance.now = () => T; Date.now = () => 1.7e12 + T;
    Math.random = () => { r = (r * 16807) % 2147483647; return (r - 1) / 2147483646; };
    window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
    window.__tick = (n, ms = 16) => { for (let i = 0; i < n; i++){ T += ms; const run = q; q = []; run.forEach(cb => cb(T)); } };
  });
  await page.goto('file://' + path.join(ROOT, 'cat-stretch.html'));
  await page.waitForFunction(() => window.catDebug);
  const GAV = {};
  // the one light, from Gav standing (the Siamese: the outline is the same in both coats)
  await page.evaluate(() => document.querySelector('input[name=coat][value=siamese]').click());
  await page.evaluate(() => catDebug.pose('stand')); await page.evaluate(() => __tick(40));
  await page.evaluate(makeLight);
  for (const coat of ['siamese', 'black']) {
    await page.evaluate(c => document.querySelector(`input[name=coat][value=${c}]`).click(), coat);
    for (const [pose, parts] of [['sit', ['head']], ['stand', ['ears', 'innerEars', 'neck', 'body', 'legs', 'fullBody', 'tail']]]) {
      await page.evaluate(n => catDebug.pose(n), pose);
      await page.evaluate(() => __tick(40));
      for (const part of parts) {
        const r = await page.evaluate(snap, part);
        if (!r) continue;
        const P = GAV[part] = GAV[part] || {};
        P[coat] = r.svg;
        if (r.spines) P.spines = r.spines;
        P.points = await page.evaluate(stagePoints, [r.svg, r.from]);
        if (r.bg) GAV.bg = r.bg;
        if (r.scale) P.scale = r.scale;
        if (r.light) P.light = r.light;
      }
    }
  }
  await browser.close();
  // (written whole, then put in place: an open Gav page reading it never gets half of it)
  const to = path.join(__dirname, 'gav-parts.js'), body = `export const GAV = ${JSON.stringify(GAV, null, 1)};\n`;
  if (fs.existsSync(to) && fs.readFileSync(to, 'utf8').endsWith(body)){ console.log('gav-parts.js: no change'); return; }   // (the same drawings: an open Gav page has nothing to make again)
  fs.writeFileSync(to + '.tmp', `// made by make-parts.js from cat-stretch.html (${new Date().toISOString().slice(0, 10)}): Gav's parts in both coats\n` +
    body);
  fs.renameSync(to + '.tmp', to);
  for (const [k, v] of Object.entries(GAV)) if (v.siamese) console.log(k.padEnd(9), 'siamese', v.siamese.length, 'black', v.black ? v.black.length : '-', 'spines', (v.spines || []).map(s => s.length).join('+') || '-', 'points', v.points.length);
})();
