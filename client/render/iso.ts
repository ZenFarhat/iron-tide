// Isometric (2:1 dimetric) projection constants and helpers.
export const TW = 60; // tile width in px
export const TH = 30; // tile height in px
export const HW = TW / 2;
export const HH = TH / 2;
export const ZH = 34; // px per cell of height
export const LEP = 256;

/** world leptons → screen px (relative to map origin) */
export function toScreen(x: number, y: number, z = 0): [number, number] {
  const cx = x / LEP,
    cy = y / LEP;
  return [(cx - cy) * HW, (cx + cy) * HH - (z / LEP) * ZH];
}

/** screen px (relative to map origin) → world cell coords (fractional), on ground plane */
export function toWorld(sx: number, sy: number): [number, number] {
  const a = sx / HW,
    b = sy / HH;
  return [(a + b) / 2, (b - a) / 2];
}

/** view vector (towards camera) in model/world space, for depth sorting & culling */
export const VIEW = [1, 1, HW / ZH];
