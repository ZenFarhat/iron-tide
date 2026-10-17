// Procedural, symmetric, deterministic map generation. Only + - * / and Math.sqrt are used
// (both exactly specified by IEEE 754), never trig, so every browser builds the same map.
import { Rng, isqrt } from "./fixed";
import { ORE_MAX, type Loco } from "./rules";

export const T_CLEAR = 0,
  T_DIRT = 1,
  T_ROUGH = 2,
  T_WATER = 3,
  T_ROCK = 4,
  T_TREE = 5,
  T_SAND = 6,
  T_PAVE = 7,
  T_ICE = 8, // frozen water: ground units cross it, ships cannot
  T_SHALLOW = 9; // fords: wadeable by ground units and navigable by ships

export type Theme = "temperate" | "snow" | "tundra" | "desert" | "safari";
export const THEMES: { id: Theme; name: string }[] = [
  { id: "temperate", name: "Temperate" },
  { id: "snow", name: "Arctic snow" },
  { id: "tundra", name: "Tundra" },
  { id: "desert", name: "Desert" },
  { id: "safari", name: "Savanna safari" },
];

/** a group of animals sharing a home range */
export interface HerdSpawn {
  type: string;
  x: number;
  y: number;
  n: number;
}

export interface MapSpec {
  seed: number;
  size: number;
  players: number;
  theme?: Theme;
}

export class GameMap {
  w: number;
  h: number;
  terrain: Uint8Array;
  ore: Uint8Array; // amount 0..ORE_MAX
  oreType: Uint8Array; // 0 none, 1 ore, 2 gem
  variant: Uint8Array; // visual variant per cell (client use only, deterministic anyway)
  starts: { x: number; y: number }[] = [];
  wells: { x: number; y: number }[] = [];
  herds: HerdSpawn[] = [];
  theme: Theme = "temperate";
  name = "";
  oreVersion = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.terrain = new Uint8Array(w * h);
    this.ore = new Uint8Array(w * h);
    this.oreType = new Uint8Array(w * h);
    this.variant = new Uint8Array(w * h);
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  idx(x: number, y: number) {
    return y * this.w + x;
  }
  groundOk(i: number) {
    const t = this.terrain[i];
    return t !== T_WATER && t !== T_ROCK && t !== T_TREE;
  }
  /** open water a ship can sail (fords included) */
  waterOk(i: number) {
    const t = this.terrain[i];
    return t === T_WATER || t === T_SHALLOW;
  }
  passable(loco: Loco, i: number) {
    const t = this.terrain[i];
    switch (loco) {
      case "naval":
        return t === T_WATER || t === T_SHALLOW;
      case "hover":
        return t !== T_ROCK && t !== T_TREE;
      case "air":
        return true;
      default:
        return t !== T_WATER && t !== T_ROCK && t !== T_TREE;
    }
  }
  buildableTerrain(i: number) {
    const t = this.terrain[i];
    return this.groundOk(i) && t !== T_ICE && t !== T_SHALLOW && this.oreType[i] === 0;
  }
  /** ground that ore can grow onto */
  oreOk(i: number) {
    const t = this.terrain[i];
    return this.groundOk(i) && t !== T_ICE && t !== T_SHALLOW;
  }
}

// ───────────────────────────── biomes ─────────────────────────────

interface Biome {
  dirt: number; // moisture noise below this → dirt (bare earth, packed snow, hardpan…)
  dunes: number; // moisture noise above this → sand (dunes), 2 = never
  rough: number; // roughness noise above this → rough ground
  water: number; // obstacle noise above this → lakes
  freeze: number; // freeze noise above this turns lake water to ice, 2 = never
  ridge: number; // half-width of rock ridges
  trees: number; // tree noise above this → woods
  lone: number; // per-mille chance of a lone tree on open ground
  shore: number; // terrain that rings lakes (-1 = none)
}

export const BIOMES: Record<Theme, Biome> = {
  temperate: { dirt: 0.36, dunes: 2, rough: 0.78, water: 0.74, freeze: 2, ridge: 0.022, trees: 0.8, lone: 0, shore: T_SAND },
  snow: { dirt: 0.3, dunes: 2, rough: 0.74, water: 0.7, freeze: 0.5, ridge: 0.03, trees: 0.78, lone: 4, shore: -1 },
  tundra: { dirt: 0.48, dunes: 2, rough: 0.64, water: 0.66, freeze: 0.68, ridge: 0.02, trees: 0.86, lone: 3, shore: T_ROUGH },
  desert: { dirt: 0.3, dunes: 0.56, rough: 0.8, water: 0.86, freeze: 2, ridge: 0.034, trees: 0.93, lone: 2, shore: T_SAND },
  safari: { dirt: 0.3, dunes: 2, rough: 0.86, water: 0.8, freeze: 2, ridge: 0.016, trees: 0.86, lone: 14, shore: T_DIRT },
};

/** wildlife groups per biome: [type, smallest group, largest group, keep at least this far from a start] */
export const FAUNA: Record<Theme, [string, number, number, number][]> = {
  temperate: [],
  snow: [["a_reindeer", 5, 7, 14], ["a_bear", 1, 2, 18], ["a_reindeer", 4, 6, 14]],
  tundra: [["a_muskox", 3, 5, 14], ["a_wolf", 3, 4, 18], ["a_reindeer", 4, 6, 14]],
  desert: [["a_camel", 3, 5, 14], ["a_jackal", 2, 3, 18], ["a_camel", 3, 4, 14]],
  safari: [["a_zebra", 5, 7, 14], ["a_giraffe", 2, 3, 14], ["a_elephant", 3, 4, 16], ["a_lion", 2, 3, 18]],
};

// ---------------------------------------------------------------------------

function valueNoise(rng: Rng, w: number, h: number, scale: number) {
  const gw = Math.ceil(w / scale) + 2,
    gh = Math.ceil(h / scale) + 2;
  const g = new Float64Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.int(10000) / 10000;
  return (x: number, y: number) => {
    const fx = x / scale,
      fy = y / scale;
    const ix = Math.floor(fx),
      iy = Math.floor(fy);
    const tx = fx - ix,
      ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix],
      b = g[iy * gw + ix + 1],
      c = g[(iy + 1) * gw + ix],
      d = g[(iy + 1) * gw + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export type Xf = (x: number, y: number) => [number, number];

/** transforms mapping player 0's territory onto each player's (point symmetry, or 4-way rotation) */
export function symmetry(W: number, H: number, four: boolean): Xf[] {
  return four
    ? [(x, y) => [x, y], (x, y) => [W - 1 - y, x], (x, y) => [W - 1 - x, H - 1 - y], (x, y) => [y, H - 1 - x]]
    : [(x, y) => [x, y], (x, y) => [W - 1 - x, H - 1 - y]];
}

export interface OreSpot {
  x: number;
  y: number;
  r: number;
  gem: boolean;
}

/** small integer hash, identical everywhere */
export function ihash(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function generateMap(spec: MapSpec): GameMap {
  const size = spec.size;
  const W = size,
    H = size;
  const m = new GameMap(W, H);
  const theme = spec.theme ?? "temperate";
  const bio = BIOMES[theme];
  m.theme = theme;
  const rng = new Rng(spec.seed * 7919 + 13);
  const four = spec.players > 2;

  const xfs = symmetry(W, H, four);
  const canon = (x: number, y: number): [number, number] => {
    let best: [number, number] = [x, y];
    for (const f of xfs) {
      // inverse orbit: apply each transform and take lexicographic min
      const p = f(x, y);
      if (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0])) best = p;
    }
    return best;
  };

  const inset = Math.max(8, Math.floor(size / 7));
  const s0 = four ? { x: inset, y: inset } : { x: inset, y: H - 1 - inset };
  for (let p = 0; p < xfs.length; p++) {
    const [x, y] = xfs[p](s0.x, s0.y);
    m.starts.push({ x, y });
  }
  // for 2p on a 4-way map, use opposite corners
  if (four && spec.players === 2) m.starts = [m.starts[0], m.starts[2]];

  const cx = (W - 1) / 2,
    cy = (H - 1) / 2;
  // Plan ore fields & fuel wells first (player 0, then mirrored) so terrain can avoid them
  const dirx = cx - s0.x,
    diry = cy - s0.y;
  const dl = Math.sqrt(dirx * dirx + diry * diry);
  const ux = dirx / dl,
    uy = diry / dl;
  const R = 0.7071;
  const rot = (a: number, b: number, cs: number, sn: number) => [a * cs - b * sn, a * sn + b * cs];
  const fields: OreSpot[] = [];
  {
    const [ax, ay] = rot(ux, uy, R, R);
    const [bx, by] = rot(ux, uy, R, -R);
    fields.push({ x: Math.round(s0.x + ax * 10), y: Math.round(s0.y + ay * 10), r: 3, gem: false });
    fields.push({ x: Math.round(s0.x + bx * 11), y: Math.round(s0.y + by * 11), r: 3, gem: false });
    const [ex, ey] = rot(ux, uy, 0.9, 0.42);
    fields.push({ x: Math.round(s0.x + ex * dl * 0.62), y: Math.round(s0.y + ey * dl * 0.62), r: 3, gem: false });
    const [fx, fy] = rot(ux, uy, 0.9, -0.42);
    fields.push({ x: Math.round(s0.x + fx * dl * 0.55), y: Math.round(s0.y + fy * dl * 0.55), r: 2, gem: true });
  }
  const placed: OreSpot[] = [];
  for (const f of fields)
    for (const xf of xfs) {
      const [x, y] = xf(f.x, f.y);
      placed.push({ x, y, r: f.r, gem: f.gem });
    }
  placed.push({ x: Math.round(cx), y: Math.round(cy), r: 3, gem: true });
  const wellSpots: { x: number; y: number }[] = [];
  {
    const [ax, ay] = rot(ux, uy, 0.8, 0.6);
    const wx = Math.round(s0.x + ax * dl * 0.75),
      wy = Math.round(s0.y + ay * dl * 0.75);
    for (const xf of xfs) {
      const [x, y] = xf(wx, wy);
      wellSpots.push({ x: Math.max(1, Math.min(W - 3, x)), y: Math.max(1, Math.min(H - 3, y)) });
    }
  }
  // distance to nearest planned feature (in canonical space it is symmetric anyway)
  const nearFeature = (x: number, y: number) => {
    for (const f of placed) {
      const d = (x - f.x) * (x - f.x) + (y - f.y) * (y - f.y);
      if (d <= (f.r + 3) * (f.r + 3)) return true;
    }
    for (const wv of wellSpots) if (Math.abs(x - wv.x - 0.5) <= 3 && Math.abs(y - wv.y - 0.5) <= 3) return true;
    return false;
  };

  const nMoist = valueNoise(rng, W, H, 9);
  const nRough = valueNoise(rng, W, H, 5);
  const nObst = valueNoise(rng, W, H, 11);
  const nTree = valueNoise(rng, W, H, 6);
  const nRidge = valueNoise(rng, W, H, 14);
  // only frozen biomes draw this noise, so temperate maps keep their old random sequence
  const nFreeze = bio.freeze < 2 ? valueNoise(rng, W, H, 13) : () => 0;

  const minStartDist = (x: number, y: number) => {
    let best = 1e9;
    for (const s of m.starts) {
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [qx, qy] = canon(x, y);
      const i = m.idx(x, y);
      const keepClear = nearFeature(x, y);
      const sd = minStartDist(qx, qy);
      const cd = Math.sqrt((qx - cx) * (qx - cx) + (qy - cy) * (qy - cy));
      let t = T_CLEAR;
      const mo = nMoist(qx, qy);
      if (mo < bio.dirt) t = T_DIRT;
      if (mo > bio.dunes) t = T_SAND;
      if (nRough(qx, qy) > bio.rough) t = T_ROUGH;
      const ob = nObst(qx, qy);
      if (!keepClear && sd > 13 && cd > 6 && ob > bio.water) t = nFreeze(qx, qy) > bio.freeze ? T_ICE : T_WATER;
      const lake = t === T_WATER || t === T_ICE;
      const r = nRidge(qx, qy);
      if (!keepClear && sd > 11 && cd > 5 && Math.abs(r - 0.5) < bio.ridge && !lake) t = T_ROCK;
      if (!keepClear && sd > 10 && cd > 4 && !lake && t !== T_ROCK) {
        if (nTree(qx, qy) > bio.trees) t = T_TREE;
        else if (ihash(qx, qy) % 1000 < bio.lone) t = T_TREE;
      }
      // map border: trees/rocks for a natural edge
      const edge = Math.min(qx, qy, W - 1 - qx, H - 1 - qy);
      if (edge < 1 && t === T_CLEAR && nTree(qx, qy) > 0.55) t = T_TREE;
      m.terrain[i] = t;
      m.variant[i] = (qx * 73856093) ^ (qy * 19349663) & 255;
    }
  }
  finishMap(m, rng, placed, wellSpots, xfs);
  return m;
}

/** shared final pass for generated and hand-made maps: shores, start clearings, ore, wells,
 *  connectivity and wildlife. Starts must already be set. */
export function finishMap(m: GameMap, rng: Rng, ore: OreSpot[], wells: { x: number; y: number }[], xfs: Xf[]) {
  const W = m.w,
    H = m.h;
  const shore = BIOMES[m.theme].shore;
  if (shore >= 0)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = m.idx(x, y);
        const t = m.terrain[i];
        if (t === T_WATER || t === T_SHALLOW || t === T_ICE || t === T_ROCK || t === T_TREE || t === T_PAVE) continue;
        let nearWater = false;
        for (let dy = -1; dy <= 1 && !nearWater; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (m.inside(nx, ny) && m.waterOk(m.idx(nx, ny))) {
              nearWater = true;
              break;
            }
          }
        if (nearWater) m.terrain[i] = shore;
      }

  // Clear start areas
  for (const s of m.starts) clearCircle(m, s.x, s.y, 9);

  // Ore fields
  for (const f of ore) placeOre(m, rng, f.x, f.y, f.r, f.gem);

  // Fuel wells
  for (const wv of wells) {
    clearRect(m, wv.x - 1, wv.y - 1, 4, 4);
    m.wells.push({ x: wv.x, y: wv.y });
  }

  // Connectivity: carve corridors from each start to the centre if needed
  ensureConnectivity(m);
  removeUnreachableOre(m);
  placeHerds(m, rng, xfs);
}

/** wildlife: herds in player 0's frame, mirrored to every other player's so nobody gets more predators */
function placeHerds(m: GameMap, rng: Rng, xfs: Xf[]) {
  const fauna = FAUNA[m.theme];
  if (!fauna.length) return;
  const rounds = Math.max(1, Math.round((m.w * m.h) / (xfs.length * 2600)));
  const ok = (x: number, y: number) => m.inside(x, y) && m.groundOk(m.idx(x, y)) && !m.oreType[m.idx(x, y)];
  for (let k = 0; k < rounds; k++)
    for (const [type, lo, hi, keep] of fauna) {
      for (let tries = 0; tries < 60; tries++) {
        const x = 2 + rng.int(m.w - 4),
          y = 2 + rng.int(m.h - 4);
        let good = true;
        for (const s of m.starts) if ((s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) < keep * keep) good = false;
        for (const h of m.herds) if ((h.x - x) * (h.x - x) + (h.y - y) * (h.y - y) < 36) good = false;
        const spots = xfs.map((f) => f(x, y));
        if (!good || !spots.every(([sx, sy]) => ok(sx, sy))) continue;
        const n = rng.range(lo, hi);
        for (const [sx, sy] of spots) m.herds.push({ type, x: sx, y: sy, n });
        break;
      }
    }
}

function clearCircle(m: GameMap, x0: number, y0: number, r: number) {
  for (let y = y0 - r; y <= y0 + r; y++)
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (!m.inside(x, y)) continue;
      if ((x - x0) * (x - x0) + (y - y0) * (y - y0) > r * r) continue;
      const i = m.idx(x, y);
      if (!m.oreOk(i) || m.terrain[i] === T_SAND) m.terrain[i] = T_CLEAR;
      m.ore[i] = 0;
      m.oreType[i] = 0;
    }
}

function clearRect(m: GameMap, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      if (!m.inside(x, y)) continue;
      const i = m.idx(x, y);
      if (!m.oreOk(i)) m.terrain[i] = T_DIRT;
      m.ore[i] = 0;
      m.oreType[i] = 0;
    }
}

function placeOre(m: GameMap, rng: Rng, x0: number, y0: number, r: number, gem: boolean) {
  for (let y = y0 - r - 1; y <= y0 + r + 1; y++)
    for (let x = x0 - r - 1; x <= x0 + r + 1; x++) {
      if (!m.inside(x, y)) continue;
      const d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
      const d = isqrt(d2 * 100) / 10;
      if (d > r + 0.6) continue;
      const i = m.idx(x, y);
      if (!m.oreOk(i)) m.terrain[i] = T_CLEAR;
      const amt = Math.max(2, Math.min(ORE_MAX, Math.round(ORE_MAX * (1 - d / (r + 1.2))) + rng.int(3)));
      m.ore[i] = amt;
      m.oreType[i] = gem ? 2 : 1;
    }
}

function ensureConnectivity(m: GameMap) {
  const W = m.w,
    H = m.h;
  let cx = Math.floor(W / 2),
    cy = Math.floor(H / 2);
  // hand-made maps may put a lake on the centre: grow from the first start instead
  if (!m.groundOk(m.idx(cx, cy)) && m.starts.length) {
    cx = m.starts[0].x;
    cy = m.starts[0].y;
  }
  for (let pass = 0; pass < 2; pass++) {
    const seen = new Uint8Array(W * H);
    const q: number[] = [m.idx(cx, cy)];
    seen[q[0]] = 1;
    if (!m.groundOk(q[0])) m.terrain[q[0]] = T_CLEAR;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % W,
        y = (i / W) | 0;
      const nb = [i - 1, i + 1, i - W, i + W];
      const ok = [x > 0, x < W - 1, y > 0, y < H - 1];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const n = nb[k];
        if (seen[n] || !m.groundOk(n)) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    let carved = false;
    for (const s of m.starts) {
      if (seen[m.idx(s.x, s.y)]) continue;
      carved = true;
      // carve a 3-wide corridor
      const steps = Math.max(Math.abs(cx - s.x), Math.abs(cy - s.y));
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(s.x + ((cx - s.x) * k) / steps),
          y = Math.round(s.y + ((cy - s.y) * k) / steps);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!m.inside(x + dx, y + dy)) continue;
            const i = m.idx(x + dx, y + dy);
            if (!m.groundOk(i)) m.terrain[i] = T_DIRT;
          }
      }
    }
    if (!carved) break;
  }
}

/** Ore that ground units cannot reach (e.g. on islands) is removed. */
function removeUnreachableOre(m: GameMap) {
  const W = m.w,
    H = m.h;
  const seen = new Uint8Array(W * H);
  const q: number[] = [];
  for (const s of m.starts) {
    const i = m.idx(s.x, s.y);
    if (!seen[i]) {
      seen[i] = 1;
      q.push(i);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % W,
      y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n] || !m.groundOk(n)) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  for (let i = 0; i < W * H; i++)
    if (m.oreType[i] && !seen[i]) {
      m.oreType[i] = 0;
      m.ore[i] = 0;
    }
}
