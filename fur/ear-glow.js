// The inner ears' colour: each has its own radial gradient (earGlowL, earGlowR in cat-stretch.html): light in the middle, the
// ear's dark at its edge and past it. All of it is set on the fur page (Inner ears) and kept with the inner ears' fur values:
//   glow [L, R] = { x, y, r, oval, turn }: each ear its own: its middle (0–1 of that inner ear's box), its width r (0–1 of the box),
//     oval: its length ÷ width, turn: which way its length lies (degrees, 0: down the ear)
//   glowMid: how far out the middle colour reaches before it turns to the outer one (0–1)
//   glowColors: [middle, outer, edge] (none: the cat page's Inner ear middle / outer and the points' dark)
// (older saves: one glowSize / glowOval / glowTurn for both ears, taken by each ear without its own)
export const GLOW = { glow: [{ x: 0.5, y: 0.55 }, { x: 0.5, y: 0.55 }], glowSize: 0.6, glowMid: 0.5, glowOval: 1, glowTurn: 0, glowColors: null };
export const glowOf = s => {
  const G = { glowSize: GLOW.glowSize, glowMid: GLOW.glowMid, glowOval: GLOW.glowOval, glowTurn: GLOW.glowTurn, ...(s || {}) };
  const ears = (s && s.glow) || GLOW.glow;
  return { glow: ears.map(q => ({ x: q.x, y: q.y, r: q.r ?? G.glowSize, oval: q.oval ?? G.glowOval, turn: q.turn ?? G.glowTurn })),
    glowMid: G.glowMid, glowColors: (s && s.glowColors) || GLOW.glowColors };
};
// the gradient's attributes for ear i (in the box's 0–1): its middle, width, and its length and turn round its middle
export function glowAttrs(s, i) {
  const q = glowOf(s).glow[i];
  const t = q.oval !== 1 || q.turn ? `translate(${q.x} ${q.y}) rotate(${q.turn}) scale(1 ${q.oval}) translate(${-q.x} ${-q.y})` : '';
  return { cx: q.x, cy: q.y, r: q.r, gradientTransform: t };
}
// a point of ear i's gradient at angle a (radians) on its edge, in the box's 0–1 (for drawing its outline and handles)
export function glowEdge(q, a, k = 1) {
  const c = Math.cos(q.turn * Math.PI / 180), s = Math.sin(q.turn * Math.PI / 180), u = q.r * Math.cos(a) * k, v = q.r * q.oval * Math.sin(a) * k;
  return [q.x + c * u - s * v, q.y + s * u + c * v];
}
// a drawing with its gradients as s says (its own stop colours kept where s gives none)
export function earGlow(svg, s) {
  const G = glowOf(s);
  return svg.replace(/<radialGradient id="earGlow([LR])"[^>]*>([\s\S]*?)<\/radialGradient>/g, (m, e, inner) => {
    const a = glowAttrs(s, e === 'L' ? 0 : 1), old = [...inner.matchAll(/stop-color="([^"]*)"/g)].map(x => x[1]), c = G.glowColors || old;
    const stops = [0, G.glowMid, 1].map((o, k) => `<stop offset="${o}"${c[k] ? ` stop-color="${c[k]}"` : ''}/>`).join('');
    return `<radialGradient id="earGlow${e}" cx="${a.cx}" cy="${a.cy}" r="${a.r}"${a.gradientTransform ? ` gradientTransform="${a.gradientTransform}"` : ''}>${stops}</radialGradient>`;
  });
}
