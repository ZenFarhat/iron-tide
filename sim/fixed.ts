// Deterministic math helpers. The simulation must produce bit-identical results on
// every client, so it only uses integer state, basic IEEE arithmetic (which is
// deterministic across engines) and no transcendental functions.

export const TPS = 20; // simulation ticks per second
export const TURN_TICKS = 2; // ticks per network turn (100ms)
export const LEP = 256; // leptons per cell (sub-cell position units)
export const HALF = LEP >> 1;

/** Exact integer square root (floor). */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return isqrt(dx * dx + dy * dy);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

// Integer atan2 producing a facing in [0,256). 0 = +x, 64 = +y (clockwise on screen
// in our iso projection). Uses a 65-entry table of atan(i/64) * 256 / 2π, precomputed
// once with exact integer literals so every engine agrees.
const ATAN_TABLE = [
  0, 1, 1, 2, 3, 3, 4, 4, 5, 6, 6, 7, 8, 8, 9, 9, 10, 11, 11, 12, 12, 13, 13, 14, 15, 15,
  16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 25, 26,
  26, 27, 27, 27, 28, 28, 29, 29, 29, 30, 30, 30, 31, 31, 31, 32, 32,
];

export function facingTo(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  let a: number;
  if (ax >= ay) a = ATAN_TABLE[Math.floor((ay * 64) / ax)];
  else a = 64 - ATAN_TABLE[Math.floor((ax * 64) / ay)];
  // a in [0,64] for first quadrant
  if (dx >= 0 && dy >= 0) return a & 255;
  if (dx < 0 && dy >= 0) return (128 - a) & 255;
  if (dx < 0 && dy < 0) return (128 + a) & 255;
  return (256 - a) & 255;
}

/** Signed smallest difference between two facings, in [-128,127]. */
export function facingDiff(from: number, to: number): number {
  let d = (to - from) & 255;
  if (d > 127) d -= 256;
  return d;
}

export function rotateToward(cur: number, target: number, rate: number): number {
  const d = facingDiff(cur, target);
  if (d > rate) return (cur + rate) & 255;
  if (d < -rate) return (cur - rate) & 255;
  return target & 255;
}

/** mulberry32-style PRNG, fully integer. */
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** integer in [0, n) */
  int(n: number): number {
    return n <= 0 ? 0 : this.next() % n;
  }
  range(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }
  chance(pct: number): boolean {
    return this.int(100) < pct;
  }
}

/** FNV-1a style hash accumulator over 32-bit ints. */
export class Hasher {
  h = 0x811c9dc5;
  add(v: number) {
    v = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= v & 255;
      this.h = Math.imul(this.h, 0x01000193);
      v >>= 8;
    }
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.add(s.charCodeAt(i));
  }
  get value() {
    return this.h >>> 0;
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Quarter-wave sine table: round(sin(i/64 * π/2) * 1024)
const SIN_Q = [
  0, 25, 50, 75, 100, 125, 150, 175, 200, 224, 249, 273, 297, 321, 345, 369, 392, 415, 438, 460,
  483, 505, 526, 548, 569, 590, 610, 630, 650, 669, 688, 706, 724, 742, 759, 775, 792, 807, 822,
  837, 851, 865, 878, 891, 903, 915, 926, 936, 946, 955, 964, 972, 980, 987, 993, 999, 1004, 1009,
  1013, 1016, 1019, 1021, 1023, 1024, 1024,
];

/** sin of facing (0..255) scaled by 1024 */
export function isin(f: number): number {
  f &= 255;
  if (f < 64) return SIN_Q[f];
  if (f < 128) return SIN_Q[128 - f];
  if (f < 192) return -SIN_Q[f - 128];
  return -SIN_Q[256 - f];
}
export function icos(f: number): number {
  return isin(f + 64);
}
