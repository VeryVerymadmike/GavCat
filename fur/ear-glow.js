// The inner ears' colour: each has its own radial gradient (earGlowL, earGlowR in cat-stretch.html): light in the middle, the
// ear's dark at its edge and past it. All of it is set on the fur page (Inner ears) and kept with the inner ears' fur values:
//   glow [L, R] = { x, y }: where each one's middle is, 0–1 of that inner ear's box (each ear its own)
//   glowSize: its size (0–1 of the box); glowMid: how far out the middle colour reaches before it turns to the outer one (0–1)
//   glowOval: 1 round … 3 long; glowTurn: which way a long one lies (degrees)
//   glowColors: [middle, outer, edge] (none: the cat page's Inner ear middle / outer and the points' dark)
export const GLOW = { glow: [{ x: 0.5, y: 0.55 }, { x: 0.5, y: 0.55 }], glowSize: 0.6, glowMid: 0.5, glowOval: 1, glowTurn: 0, glowColors: null };
export const glowOf = s => ({ glow: (s && s.glow) || GLOW.glow, glowSize: (s && s.glowSize) ?? GLOW.glowSize, glowMid: (s && s.glowMid) ?? GLOW.glowMid,
  glowOval: (s && s.glowOval) ?? GLOW.glowOval, glowTurn: (s && s.glowTurn) ?? GLOW.glowTurn, glowColors: (s && s.glowColors) || GLOW.glowColors });
// the gradient's attributes for ear i: its middle, size and, when long, the stretch and turn round its middle (in the box's 0–1)
export function glowAttrs(s, i) {
  const { glow, glowSize, glowOval, glowTurn } = glowOf(s), q = glow[i];
  const t = glowOval !== 1 || glowTurn ? `translate(${q.x} ${q.y}) rotate(${glowTurn}) scale(1 ${glowOval}) translate(${-q.x} ${-q.y})` : '';
  return { cx: q.x, cy: q.y, r: glowSize, gradientTransform: t };
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
