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
      (sia ? `<g transform="${Mx(toSkull(stain))}"><path filter="url(#stainMap)" d="${stain.getAttribute('d')}"/></g>` : '') + '</svg>';
    return { svg, from: [[n.x, n.y]], bg: S.bgColor };
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
  const leg = k => item([$('leg-' + k), $('low-' + k), $('ptLow-' + k)?.parentNode], [$('leg-' + k), $('low-' + k)], p.legs[k]);
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
      body += `<g transform="translate(${f(dx)} ${f(dy)})">${it.s}<polyline data-fur-spine="" fill="none" points="${it.spine.map(q => q[0] + ',' + q[1]).join(' ')}"/></g>`;
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
  await page.goto('file://' + path.join(ROOT, 'cat-stretch.html'));
  await page.waitForFunction(() => window.catDebug);
  const GAV = {};
  for (const coat of ['siamese', 'black']) {
    await page.evaluate(c => document.querySelector(`input[name=coat][value=${c}]`).click(), coat);
    for (const [pose, parts] of [['sit', ['head']], ['stand', ['ears', 'innerEars', 'neck', 'body', 'legs', 'fullBody', 'tail']]]) {
      await page.evaluate(n => catDebug.pose(n), pose);
      await page.waitForTimeout(500);
      for (const part of parts) {
        const r = await page.evaluate(snap, part);
        if (!r) continue;
        const P = GAV[part] = GAV[part] || {};
        P[coat] = r.svg;
        if (r.spines) P.spines = r.spines;
        P.points = await page.evaluate(stagePoints, [r.svg, r.from]);
        if (r.bg) GAV.bg = r.bg;
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'gav-parts.js'),
    `// made by make-parts.js from cat-stretch.html (${new Date().toISOString().slice(0, 10)}): Gav's parts in both coats\n` +
    `export const GAV = ${JSON.stringify(GAV, null, 1)};\n`);
  for (const [k, v] of Object.entries(GAV)) if (v.siamese) console.log(k.padEnd(9), 'siamese', v.siamese.length, 'black', v.black ? v.black.length : '-', 'spines', (v.spines || []).map(s => s.length).join('+') || '-', 'points', v.points.length);
})();
