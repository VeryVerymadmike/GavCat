// The inner ears' colour: each has its own radial gradient (earGlowL, earGlowR in cat-stretch.html): light in the middle, the
// ear's dark at its edge and past it. Where its middle is and how big it is are set on the fur page and kept with the inner
// ears' fur values: glow [L, R] = { x, y }, 0–1 of that inner ear's box; glowSize = its size (0–1 of the box).
export const GLOW = { glow: [{ x: 0.5, y: 0.55 }, { x: 0.5, y: 0.55 }], glowSize: 0.6 };
export const glowOf = s => ({ glow: (s && s.glow) || GLOW.glow, glowSize: (s && s.glowSize) ?? GLOW.glowSize });
// a drawing with its gradients placed as s says
export function earGlow(svg, s) {
  const { glow, glowSize } = glowOf(s);
  return svg.replace(/<radialGradient id="earGlow([LR])"[^>]*>/g, (m, e) => { const q = glow[e === 'L' ? 0 : 1];
    return `<radialGradient id="earGlow${e}" cx="${q.x}" cy="${q.y}" r="${glowSize}">`; });
}
